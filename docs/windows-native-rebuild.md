# Windows Native Module Rebuild

`better-sqlite3` is a native Node module. On Windows, Electron must load a build of `better-sqlite3` that matches Electron's bundled Node.js ABI, not only the system Node.js version.

After installing dependencies, run:

```powershell
npm.cmd run rebuild:native
```

This runs:

```powershell
electron-rebuild -f -w better-sqlite3
```

Keep SQLite access in the Electron main process. Do not import `better-sqlite3` from renderer code.
