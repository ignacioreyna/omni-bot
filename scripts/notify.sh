#!/bin/sh
# Claude Code hook (Notification / Stop) -> ntfy push notification.
# Tapping the notification opens that terminal (tmux pane) in Omni-Bot.
#
# Env: NTFY_TOPIC (required), NTFY_SERVER (default https://ntfy.sh),
#      OMNI_BOT_URL (e.g. https://omni-bot.example.com)

[ -z "$NTFY_TOPIC" ] && exit 0

input=$(cat)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "Notification"')
message=$(printf '%s' "$input" | jq -r '.message // "Claude finished"')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')

# The pane, not the session: with one desktop session per user, #S is always "main"
label=""
if [ -n "$TMUX_PANE" ]; then
  label=$(tmux display-message -p -t "$TMUX_PANE" '#{window_name}' 2>/dev/null)
  case "$label" in zsh | bash | fish | sh | claude | "") label="" ;; esac
fi
[ -z "$label" ] && [ -n "$cwd" ] && label=$(basename "$cwd")
# HTTP headers are latin1; keep the title ASCII
title="Claude${label:+ - $label}"

click=""
if [ -n "$OMNI_BOT_URL" ] && [ -n "$TMUX_PANE" ]; then
  click="$OMNI_BOT_URL/#/p/$(printf '%s' "$TMUX_PANE" | jq -sRr @uri)"
fi

[ "$event" = "Stop" ] && message="Finished — waiting for you"

curl -s -o /dev/null --max-time 5 \
  -H "Title: $title" \
  ${click:+-H "Click: $click"} \
  -d "$message" \
  "${NTFY_SERVER:-https://ntfy.sh}/$NTFY_TOPIC" || true
