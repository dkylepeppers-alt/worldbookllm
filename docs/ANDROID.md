# Running on Android (Termux)

worldbookllm runs on an Android phone or tablet under [Termux](https://termux.dev). Install Termux from [F-Droid](https://f-droid.org/packages/com.termux/) or its [GitHub releases](https://github.com/termux/termux-app/releases). The Play Store build is older and isn't recommended. The app's server runs in Termux, and you use it in your phone's browser at `http://localhost:3001`.

There are two ways to run it:

- **Native Termux** (recommended). It's faster and needs no extra Linux install. The SQLite library (`better-sqlite3`) has no prebuilt binary for Android, so it compiles from source during `pnpm install`. That needs Termux's compiler packages and takes a few minutes, once.
- **A Debian guest under proot-distro.** Use it if the native build fails on your device, or if you'd rather use a regular Linux toolchain. Node and SQLite use ordinary Linux arm64 binaries there, so nothing compiles. proot slows down file-heavy work, though, so installing and building take longer, and the app is a little slower.

Both need about 1.5 GB of free storage and a provider API key (or a model server elsewhere on your network). A phone can't run a useful model itself.

## Native Termux

### Install

```bash
# 1. Update Termux, then install Node.js 24, npm, git, and the build tools
#    better-sqlite3 needs to compile.
pkg update && pkg upgrade
pkg install nodejs-lts npm git python clang make binutils

node -v                  # should print v24.x

# 2. pnpm, installed with npm. pnpm then switches itself to the exact
#    version the project pins.
npm install -g pnpm@10

# 3. Get the code and install its dependencies. better-sqlite3 compiles here,
#    which takes a few minutes.
cd ~
git clone https://github.com/dkylepeppers-alt/worldbookllm.git
cd worldbookllm
pnpm install

# 4. Build the app.
pnpm build
```

`nodejs-lts` is Node 24, the version the project is developed and tested on. Termux's other Node package, `nodejs`, tracks the newest release. It also works, since the app needs Node 24 or later, but `nodejs-lts` is the safer choice. The two packages replace each other, so install only one. Neither includes npm any more, which is why `npm` is in the install line.

### Start

```bash
cd ~/worldbookllm
pnpm start
```

Then open **http://localhost:3001** in your browser. Add a provider key under Settings, and create a book. Stop the server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

`localhost` counts as a secure origin, so you can install worldbookllm as an app straight from the browser menu (**Add to Home screen** or **Install app**), with no HTTPS setup. The installed app still needs the server running in Termux.

To keep the server running while you use other apps:

- Run `termux-wake-lock` (or tap **Acquire wakelock** in Termux's notification) before a long session.
- In Android's settings, turn off battery optimisation for Termux. Otherwise Android may stop the server in the background.
- To keep it running after you close the Termux session, start it inside `tmux` (`pkg install tmux`, then `tmux new -s worldbook` and `pnpm start`; detach with <kbd>Ctrl</kbd>+<kbd>B</kbd> <kbd>D</kbd>, come back with `tmux attach -t worldbook`).

### Update

```bash
cd ~/worldbookllm
git pull
pnpm install
pnpm build
```

Then stop the server and start it again with `pnpm start`. The database updates itself when the server starts, and your books are never changed by an update.

Updating Termux's packages (`pkg upgrade`) can move Node to a newer release. You don't need to reinstall anything when it does, because better-sqlite3 is built on Node-API, which stays compatible across Node versions. If the server ever fails to start after a Node update with an error about `better_sqlite3.node`, run `pnpm rebuild better-sqlite3`.

## Debian under proot-distro

### Install

In Termux:

```bash
pkg update && pkg upgrade
pkg install proot-distro
proot-distro install debian
proot-distro login debian
```

You're now in a Debian shell as `root`. Debian's own Node.js is too old, so install Node 24 from NodeSource:

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates git python3 make g++
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs

node -v                  # should print v24.x
npm install -g pnpm@10

cd ~
git clone https://github.com/dkylepeppers-alt/worldbookllm.git
cd worldbookllm
pnpm install
pnpm build
```

pnpm still runs better-sqlite3's build step, which needs `python3` and `make` even though it only confirms the prebuilt binary is there and compiles nothing. `g++` is only needed if that check fails and it falls back to compiling from source; it's in the list so the install still succeeds then.

### Start

From Termux, in one line:

```bash
proot-distro login debian -- bash -lc 'cd ~/worldbookllm && pnpm start'
```

Or log in first (`proot-distro login debian`), then run `cd ~/worldbookllm && pnpm start`. Open **http://localhost:3001** in your browser. The Debian guest shares the phone's network, so this is the same address as for native Termux, and installing as an app works the same way. The wake lock, battery and `tmux` advice above applies too; run `tmux` in Termux, outside the guest.

Leave `HOST` at its default (`127.0.0.1`). In particular, don't set `HOST=0.0.0.0` inside proot: the server lists the phone's network interfaces when it listens on every address, Android doesn't allow that inside proot, and the server exits. To reach the app from another device, set `HOST` to the phone's own Wi-Fi address instead.

### Update

```bash
proot-distro login debian
cd ~/worldbookllm
git pull
pnpm install
pnpm build
```

Then start it again. `apt upgrade` inside the guest keeps Node 24 up to date from NodeSource.

### Where your data lives

The app's data is at `~/worldbookllm/data` inside the guest. On the Termux side, that's under `$PREFIX/var/lib/proot-distro/`. **`proot-distro remove debian` deletes the guest and your books with it**, so back up first (see below).

## Your data and backups

Everything worth keeping is in the `data` folder in the worldbookllm directory: your books as Markdown, the database, your API keys, and your skills. See [Backups](DEPLOYMENT.md#backups) for what each part is.

- **Keep `data/` where it is.** Don't point `DATA_DIR` at shared storage (`/sdcard` or `~/storage/shared`). Android's shared storage doesn't support the file locking SQLite needs.
- **To back up**, stop the server and copy an archive of the folder to shared storage. Run `termux-setup-storage` in Termux once first, to give Termux access to it.

  Native Termux:

  ```bash
  tar czf ~/storage/shared/worldbook-backup.tar.gz -C ~/worldbookllm data
  ```

  Inside the Debian guest (proot-distro makes `/sdcard` available there):

  ```bash
  tar czf /sdcard/worldbook-backup.tar.gz -C ~/worldbookllm data
  ```

- **To restore**, stop the server and unpack the archive into the worldbookllm directory: `tar xzf <archive> -C ~/worldbookllm`.

## Troubleshooting

- **`pnpm install` fails with `gyp: Undefined variable android_ndk_path`** (native Termux). node-gyp picked up Node's upstream build settings instead of Termux's. Define the variable and install again:

  ```bash
  mkdir -p ~/.gyp && echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
  pnpm install
  ```

- **The server stops at start with `Could not locate the bindings file` or `Cannot find module …better_sqlite3.node`.** better-sqlite3 didn't compile. Make sure `python`, `clang` and `make` are installed (`python3`, `make` and `g++` in Debian), then run `pnpm rebuild better-sqlite3`.
- **`Unsupported engine` or a syntax error at start.** Node is older than 24. Run `node -v`; in Termux install `nodejs-lts`, and in Debian install Node 24 from NodeSource as above.
- **`pnpm build` runs out of memory** on a phone with little RAM. Close other apps and retry with `NODE_OPTIONS=--max-old-space-size=2048 pnpm build`.
- **`EADDRINUSE` at start.** Another copy of the server is still running, perhaps in another Termux session or `tmux` window. Stop it, or start this one on another port: `PORT=3002 pnpm start`.
- **Warnings about `sharp`** are harmless. It's an image library used only by a script that regenerates the app icons, and the icons are already in the repository.
- **Local models:** point the `custom` provider (Settings) at an Ollama or llama.cpp server on another computer on your network, for example `http://192.168.1.20:11434/v1`.
