#!/bin/sh
# Claude Code hook (Notification / Stop) -> ntfy push notification.
# Tapping the notification opens the tmux session in Omni-Bot.
#
# Env: NTFY_TOPIC (required), NTFY_SERVER (default https://ntfy.sh),
#      OMNI_BOT_URL (e.g. https://omni-bot.example.com)

[ -z "$NTFY_TOPIC" ] && exit 0

input=$(cat)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "Notification"')
message=$(printf '%s' "$input" | jq -r '.message // "Claude finished"')

session=""
[ -n "$TMUX" ] && session=$(tmux display-message -p '#S' 2>/dev/null)
# HTTP headers are latin1; keep the title ASCII
title="Claude${session:+ - $session}"

click=""
if [ -n "$OMNI_BOT_URL" ] && [ -n "$session" ]; then
  click="$OMNI_BOT_URL/#/s/$(printf '%s' "$session" | jq -sRr @uri)"
fi

[ "$event" = "Stop" ] && message="Finished — waiting for you"

curl -s -o /dev/null --max-time 5 \
  -H "Title: $title" \
  ${click:+-H "Click: $click"} \
  -d "$message" \
  "${NTFY_SERVER:-https://ntfy.sh}/$NTFY_TOPIC" || true
