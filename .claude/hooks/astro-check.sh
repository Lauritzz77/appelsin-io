#!/usr/bin/env bash
# Guardrail (Stop hook): run `astro check` when Claude finishes a turn and block
# the turn (exit 2, errors fed back to the model) if there are type errors.
#
# - Loop-safe: when we're already in a stop-hook-triggered continuation
#   (stop_hook_active=true) we don't block again, so a hard-to-fix error can't
#   trap the session in a loop. The next fresh turn re-checks until it's clean.
# - Cheap on chat turns: skips the check when no source file changed since the
#   last clean run, so a typecheck only runs after the code actually changed.

input=$(cat)
case "$input" in
	*'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

stamp="$(git rev-parse --git-dir 2>/dev/null || echo .)/astro-check.stamp"
if [ -f "$stamp" ]; then
	changed=$(find src cms astro.config.mjs tsconfig.json -newer "$stamp" -type f 2>/dev/null | head -n 1)
	[ -z "$changed" ] && exit 0
fi

output=$(pnpm -s check 2>&1)
status=$?
if [ "$status" -ne 0 ]; then
	{
		echo "Guardrail: \`pnpm check\` (astro check) reported type errors — fix them before finishing:"
		echo
		echo "$output"
	} >&2
	exit 2
fi

# Clean — record the time so unchanged follow-up turns skip the check.
touch "$stamp"
exit 0
