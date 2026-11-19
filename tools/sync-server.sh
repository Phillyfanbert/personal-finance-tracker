#!/usr/bin/env bash
# ============================================================================
# Keeps the SERVER MACHINE's copy of tools/ level with this repository.
# Run on the SERVER MACHINE only, never from a checkout (it refuses).
#
# Why this exists. The server's tools directory is a flat copy with no git
# checkout, and for eight weeks nobody copied anything into it. The market-
# hours gate, the market-wide headlines and the per-mover "why" lines had all
# been merged, described as shipped, and were simply not running. Nothing
# reported it, because a directory that has stopped changing looks exactly
# like one that is up to date. This job makes the copy follow main on its own
# and writes down what it is running where it can be read without SSH.
#
# What it does, every SYNC_INTERVAL_SECONDS (15 minutes by default):
#   1. Fetches main from the public repository into a private clone kept
#      beside the home directory. Anonymous HTTPS: the repository is public,
#      so this machine holds no GitHub credential at all.
#   2. If main has not moved since the last deploy, stops.
#   3. Syntax-checks every script in the new commit BEFORE touching anything
#      (node --check, bash -n). A commit that fails is REFUSED: the machine
#      keeps running the last good code and the refusal is reported. A bad
#      push must not be able to take four unattended jobs down at once.
#   4. Copies the scripts into the live directory one at a time, each as a
#      rename, so a job that happens to start mid-sync reads a whole file.
#   5. Records the commit it deployed, and reports it.
#
# What it never touches: .env.deal-agent. That file holds the service-role
# key, is not in the repository, and exists only here.
#
# What it cannot do: change a launchd schedule. Those are installed by
# setup-server-machine.sh, which is not safe to run unattended (it mints a
# new proxy secret unless handed the existing one). When that file changes
# the status says so, and keeps saying so until someone acknowledges it with
# `./sync-server.sh --ack-schedules`.
#
# Trust. This deploys whatever is on main to a machine that holds a key able
# to read the whole database, so the boundary is "who can push to main",
# exactly as it already is for the Cloudflare deploy of the app itself.
#
# Is the server behind? From anywhere with database access:
#   select status, detail, now() - ran_at as age
#   from agent_run_status where agent = 'server-sync';
# `detail` leads with the short commit; compare it with
# `git rev-parse --short origin/main`. A ran_at that has stopped moving means
# this job itself has died, which is the one failure it cannot report.
#
# Usage (on the server, from its tools directory):
#   ./sync-server.sh                  sync once, now
#   ./sync-server.sh --install        install and start the launchd job
#   ./sync-server.sh --status         print what is deployed
#   ./sync-server.sh --ack-schedules  clear the "schedules changed" note
#
# Written for /bin/bash 3.2, which is what launchd runs on macOS.
# ============================================================================
set -uo pipefail

RUN_DIR="${SYNC_RUN_DIR:-$(cd "$(dirname "$0")" && pwd)}"
CLONE_DIR="${SYNC_CLONE_DIR:-$HOME/.personal-finance-repo}"
REPO_URL="${SYNC_REPO_URL:-https://github.com/Phillyfanbert/personal-finance-tracker.git}"
BRANCH="${SYNC_BRANCH:-main}"
INTERVAL_SECONDS="${SYNC_INTERVAL_SECONDS:-900}"
LABEL="com.server-sync.interval"
STAMP="$RUN_DIR/.deployed-commit"
SCHEDULES_NOTE="$RUN_DIR/.schedules-changed"
LOCK="$RUN_DIR/.sync.lock"

# launchd hands a job /usr/bin:/bin:/usr/sbin:/sbin and nothing else, which
# is how a different job here failed every hour for days. Homebrew's node is
# needed for the syntax gate.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
short() { printf '%s' "${1:-}" | cut -c1-7; }

# Writes the agent_run_status row. Best effort: a failure to report must
# never stop a sync that has already happened, the same rule every agent's
# own writeRunStatus() follows. Node rather than curl so no value is ever
# assembled into JSON by hand, and the env file is PARSED, not sourced.
report() {
  local status="$1" detail="$2"
  [ "${SYNC_NO_REPORT:-0}" = "1" ] && return 0
  [ -f "$RUN_DIR/.env.deal-agent" ] || { say "no .env.deal-agent here, not reporting"; return 0; }
  SYNC_STATUS="$status" SYNC_DETAIL="$detail" SYNC_ENV_FILE="$RUN_DIR/.env.deal-agent" node -e '
    const fs = require("fs");
    const env = {};
    for (const line of fs.readFileSync(process.env.SYNC_ENV_FILE, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z_]+)=(.*)$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["\x27]|["\x27]$/g, "");
    }
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) { console.error("no Supabase settings, not reporting"); process.exit(0); }
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 15000);
    const ok = process.env.SYNC_STATUS === "ok";
    fetch(url + "/rest/v1/agent_run_status?on_conflict=agent", {
      method: "POST",
      signal: stop.signal,
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{
        agent: "server-sync",
        status: process.env.SYNC_STATUS,
        detail: process.env.SYNC_DETAIL || null,
        queries_attempted: 1,
        queries_failed: ok ? 0 : 1,
        ran_at: new Date().toISOString(),
      }]),
    }).then(async (res) => {
      clearTimeout(timer);
      if (!res.ok) console.error("status write HTTP " + res.status + ": " + (await res.text()).slice(0, 200));
    }).catch((err) => { clearTimeout(timer); console.error("status write failed: " + err.message); });
  ' || true
}

# The first script in a directory that does not parse, or nothing.
first_broken_script() {
  local dir="$1" f
  for f in "$dir"/*.js "$dir"/*.mjs; do
    [ -f "$f" ] || continue
    node --check "$f" >/dev/null 2>&1 || { basename "$f"; return 0; }
  done
  for f in "$dir"/*.sh; do
    [ -f "$f" ] || continue
    bash -n "$f" >/dev/null 2>&1 || { basename "$f"; return 0; }
  done
  return 0
}

# Copies scripts only, by name pattern, so nothing unexpected in the
# repository's tools/ can land here and nothing here that is not a script
# (the env file above all) can be replaced. No deletes: a file removed from
# the repository is left behind, which is harmless, where a mistaken delete
# in this directory would not be.
deploy_scripts() {
  local src="$1" f base tmp
  for f in "$src"/*.js "$src"/*.mjs "$src"/*.sh "$src"/*.py "$src"/.env.deal-agent.example; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    tmp="$RUN_DIR/.sync-tmp.$$.$base"
    cp "$f" "$tmp" || { rm -f "$tmp"; return 1; }
    # Every wrapper is made executable whatever the repository recorded. Two
    # of them are stored as 644, and a hand-run of one of those would
    # otherwise fail with "permission denied" for no visible reason.
    case "$base" in
      *.sh) chmod 755 "$tmp" ;;
      *) if [ -x "$f" ]; then chmod 755 "$tmp"; else chmod 644 "$tmp"; fi ;;
    esac
    mv -f "$tmp" "$RUN_DIR/$base" || { rm -f "$tmp"; return 1; }
  done
  return 0
}

# Empty when the file is not there yet. Tested for first rather than letting
# the redirection fail: that failure is the shell's own and prints whatever
# is done to silence the command after it.
setup_checksum() {
  [ -f "$RUN_DIR/setup-server-machine.sh" ] || return 0
  cksum < "$RUN_DIR/setup-server-machine.sh"
}

# The Gemma proxy is the one script here that runs ALL THE TIME rather than
# on a schedule, so copying a new version in changes nothing until its
# process restarts: the old code keeps answering until the next reboot. It is
# compared against what the proxy was last restarted FOR, not against the
# copy that was there before, because the sync that first delivers this
# function is still the previous script and never sees the change happen.
# Restarting takes a second and the secret lives in the job's own plist, so
# nothing else changes. Not installed here means nothing to restart.
PROXY_LABEL="com.gemma-auth-proxy"
PROXY_STAMP="$RUN_DIR/.proxy-restarted-for"
restart_proxy_if_changed() {
  local file="$RUN_DIR/gemma-auth-proxy.js" domain now
  [ -f "$file" ] || return 0
  domain="gui/$(id -u)"
  launchctl print "$domain/$PROXY_LABEL" >/dev/null 2>&1 || return 0
  now="$(cksum < "$file")"
  [ "$now" = "$(cat "$PROXY_STAMP" 2>/dev/null)" ] && return 0
  if launchctl kickstart -k "$domain/$PROXY_LABEL" >/dev/null 2>&1; then
    printf '%s\n' "$now" > "$PROXY_STAMP"
    say "restarted $PROXY_LABEL so it runs the code just copied in"
  else
    say "could not restart $PROXY_LABEL, will try again on the next run"
  fi
}

# The daily database backup (backup-database.mjs) rides on this job rather
# than getting a launchd job of its own: this already runs every 15 minutes
# with the key it needs, and installing a new job would mean someone running
# setup-server-machine.sh by hand, which mints a new proxy secret. --if-due
# makes every run but the first of the day a quick file-exists check. It runs
# whether or not the code sync itself worked, since a backup has nothing to do
# with whether GitHub was reachable, but only while this run holds the lock,
# so two backups can never overlap. Its own failures are reported to
# agent_run_status as "backup" and never fail the sync.
run_backup_if_due() {
  [ -f "$RUN_DIR/backup-database.mjs" ] || return 0
  [ -f "$RUN_DIR/.env.deal-agent" ] || return 0
  node "$RUN_DIR/backup-database.mjs" --if-due || say "backup did not complete, see its status row"
}

# The daily balance check (reconcile-balances.mjs) rides on this job for the
# same reasons the backup does. --if-due makes every run but the first of the
# day one small read. It reports to agent_run_status as "reconcile" and, like
# the backup, never fails the sync.
run_reconcile_if_due() {
  [ -f "$RUN_DIR/reconcile-balances.mjs" ] || return 0
  [ -f "$RUN_DIR/.env.deal-agent" ] || return 0
  node "$RUN_DIR/reconcile-balances.mjs" --if-due || say "balance check did not complete, see its status row"
}

schedules_note() {
  [ -f "$SCHEDULES_NOTE" ] || return 0
  printf ' setup-server-machine.sh changed in %s: launchd schedules are not applied on their own, see sync-server.sh.' "$(short "$(cat "$SCHEDULES_NOTE" 2>/dev/null)")"
}

sync_once() {
  # A checkout is where the scripts are WRITTEN. Running this there would
  # overwrite work in progress with whatever is on main.
  if git -C "$RUN_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$RUN_DIR is inside a git checkout, not the server's copy of tools/. Refusing to run here." >&2
    return 2
  fi

  # One at a time. A lock left behind by a crash is cleared after half an
  # hour rather than blocking every sync from then on.
  if ! mkdir "$LOCK" 2>/dev/null; then
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
      say "clearing a stale lock"
      rmdir "$LOCK" 2>/dev/null
      mkdir "$LOCK" 2>/dev/null || { say "could not take the lock"; return 0; }
    else
      say "another sync is running, leaving it to finish"
      return 0
    fi
  fi
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
  HAVE_LOCK=1

  local deployed target bad
  deployed="$(cat "$STAMP" 2>/dev/null || true)"

  for tool in git node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      say "$tool not found on PATH"
      report degraded "Cannot sync: $tool is not installed here. Still running $(short "$deployed")."
      return 1
    fi
  done

  if [ ! -d "$CLONE_DIR/.git" ]; then
    # Never removed and never reused if it is something else: this path is
    # configurable, and a wrong value must fail rather than delete.
    if [ -e "$CLONE_DIR" ]; then
      say "$CLONE_DIR exists and is not a clone"
      report degraded "Cannot sync: $CLONE_DIR exists and is not a clone of the repository. Still running $(short "$deployed")."
      return 1
    fi
    say "cloning $REPO_URL"
    if ! git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR" 2>&1; then
      report degraded "Could not clone the repository. Still running $(short "$deployed")."
      return 1
    fi
  fi

  # Pinned every run, so a clone can never quietly start following somewhere
  # else.
  git -C "$CLONE_DIR" remote set-url origin "$REPO_URL"
  if ! git -C "$CLONE_DIR" fetch --quiet --depth 1 origin "$BRANCH" 2>&1; then
    say "could not reach the repository"
    report degraded "Could not reach the repository. Still running $(short "$deployed").$(schedules_note)"
    return 1
  fi
  target="$(git -C "$CLONE_DIR" rev-parse FETCH_HEAD)"

  if [ "$target" = "$deployed" ]; then
    say "up to date at $(short "$target")"
    restart_proxy_if_changed
    report ok "$(short "$target")$(schedules_note)"
    return 0
  fi

  say "main moved: $(short "$deployed") -> $(short "$target")"
  if ! git -C "$CLONE_DIR" checkout --quiet --force --detach FETCH_HEAD 2>&1; then
    report degraded "Could not check out $(short "$target"). Still running $(short "$deployed")."
    return 1
  fi

  bad="$(first_broken_script "$CLONE_DIR/tools")"
  if [ -n "$bad" ]; then
    say "REFUSED $(short "$target"): $bad does not parse"
    report failed "Commit $(short "$target") was NOT deployed: $bad fails its syntax check. Still running $(short "$deployed")."
    return 1
  fi

  # Compared before and after rather than read from the git log: the clone is
  # shallow, and what matters is whether the file HERE changed.
  local setup_before setup_after
  setup_before="$(setup_checksum)"

  if ! deploy_scripts "$CLONE_DIR/tools"; then
    say "copy failed part-way"
    report failed "Copying $(short "$target") into place failed part-way. Some scripts may be newer than others."
    return 1
  fi

  setup_after="$(setup_checksum)"
  # Only when there was something deployed before to compare against. On the
  # very first sync every file is "new" and that says nothing about schedules.
  if [ -n "$deployed" ] && [ "$setup_before" != "$setup_after" ]; then
    printf '%s\n' "$target" > "$SCHEDULES_NOTE"
  fi

  printf '%s\n' "$target" > "$STAMP.tmp" && mv -f "$STAMP.tmp" "$STAMP"
  say "deployed $(short "$target")"
  restart_proxy_if_changed
  report ok "$(short "$target")$(schedules_note)"
  return 0
}

install_job() {
  local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  local domain="gui/$(id -u)"
  mkdir -p "$HOME/Library/LaunchAgents"
  # RunAtLoad so a reboot syncs straight away instead of a quarter of an hour
  # later. /bin/bash explicitly, like every other job here, so the script's
  # own mode cannot stop it starting.
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RUN_DIR}/sync-server.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/${LABEL}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${LABEL}.log</string>
</dict>
</plist>
EOF
  # bootout is asynchronous, so an immediate bootstrap of the same label can
  # fail once and succeed a moment later. Same retry setup-server-machine.sh
  # uses, for the same measured reason.
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  sleep 1
  if ! launchctl bootstrap "$domain" "$plist" 2>/dev/null; then
    sleep 2
    launchctl bootstrap "$domain" "$plist"
  fi
  echo "Installed $LABEL: every ${INTERVAL_SECONDS}s, log at /tmp/${LABEL}.log"
}

case "${1:-}" in
  --install) install_job ;;
  --status)
    echo "deployed commit: $(cat "$STAMP" 2>/dev/null || echo "none recorded")"
    [ -f "$SCHEDULES_NOTE" ] && echo "schedules changed in: $(cat "$SCHEDULES_NOTE")"
    exit 0 ;;
  --ack-schedules)
    rm -f "$SCHEDULES_NOTE"
    echo "Cleared. The next sync reports without the note." ;;
  "")
    sync_once
    rc=$?
    if [ "${HAVE_LOCK:-0}" = "1" ]; then
      run_backup_if_due
      run_reconcile_if_due
    fi
    exit "$rc" ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
