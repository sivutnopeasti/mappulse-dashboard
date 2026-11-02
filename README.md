# MapPulse dashboard

Static control panel for the private `youtube-shorts-bot` pipeline. It runs entirely in the browser
and talks to the GitHub API with a fine-grained personal access token that is stored only in the
browser's localStorage. No data or secrets live in this repository.

Token permissions (only for `youtube-shorts-bot`): Contents, Actions and Workflows = Read and write.
