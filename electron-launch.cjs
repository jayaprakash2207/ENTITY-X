// Launcher that clears ELECTRON_RUN_AS_NODE before starting Electron.
// This env var is set in some shells (e.g. MSYS2/Git Bash) and forces
// Electron into Node.js-only mode, breaking the browser process.
const electron = require('electron');
const { spawn } = require('child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const proc = spawn(electron, ['.'], { env, stdio: 'inherit', windowsHide: false });
proc.on('close', code => process.exit(code || 0));
