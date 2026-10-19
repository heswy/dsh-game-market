These logs are from a first attempt where DSH_GAME_CLI was not exported in the
shell. The generated dsh-game.config.json does not record the CLI path, so the
local wrappers exit 2 with "cannot find the dsh-game CLI". The Skill's create
step exports DSH_GAME_CLI; the same variable must be present for every later
shell. The real C-21 evidence logs are the numbered *.log files in the parent
directory after this note was written.
