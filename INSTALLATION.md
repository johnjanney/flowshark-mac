# Installing FlowShark on a Mac

This guide covers both ways of getting FlowShark onto your Mac:

- **[Option A — Install a release build](#option-a--install-a-release-build)**
  if a `.dmg` is attached to a release on GitHub. Takes about a minute.
- **[Option B — Build it yourself from the repository](#option-b--build-it-yourself-from-the-repository)**
  if there is no release yet, or you want to build from a specific commit.
  Takes about 20 minutes the first time, mostly waiting for Rust to compile.

If a step does not go as described, jump to
[Troubleshooting](#troubleshooting) at the end.

---

## Before you start

Check that your Mac meets the requirements.

1. Choose  > **About This Mac**.
2. Confirm two things:
   - **macOS 14 Sonoma or later.** FlowShark will not launch on macOS 13 or
     earlier.
   - **A chip that begins with "Apple"** — Apple M1, M2, M3, M4, or later.
     FlowShark does not run on Intel Macs.

---

## Option A — Install a release build

### 1. Download the disk image

1. Open <https://github.com/johnjanney/flowshark-mac/releases>.
2. Open the newest release at the top of the page.
3. Under **Assets**, click the file whose name ends in `.dmg` — for example
   `FlowShark_0.1.0_aarch64.dmg`.
4. Wait for the download to finish. Safari puts it in your **Downloads**
   folder.

### 2. Open the disk image

1. Open the **Downloads** folder in the Finder.
2. Double-click the `.dmg` file.
3. A window opens showing the **FlowShark** icon on the left and a shortcut to
   your **Applications** folder on the right.

### 3. Install the app

1. Drag the **FlowShark** icon onto the **Applications** shortcut.
2. Wait for the copy to finish.
3. Close the disk image window.
4. In the Finder sidebar, click the **eject** button (⏏) next to *FlowShark*
   to unmount the disk image.
5. You can delete the `.dmg` from Downloads.

### 4. Open FlowShark for the first time

1. Open the **Applications** folder.
2. Double-click **FlowShark**.

If the release was signed and notarised, it opens straight away with no
warning. If macOS says the app "cannot be opened because the developer cannot
be verified", the build was not notarised — follow
[Opening an unsigned build](#opening-an-unsigned-build) below.

### 5. Confirm it worked

- The FlowShark menu bar appears at the top of the screen.
- A window opens with a starter flowchart.
- Choose **FlowShark > About FlowShark** and check the version number.

---

## Option B — Build it yourself from the repository

### 1. Install the Xcode Command Line Tools

These provide the compiler and linker macOS needs to build the app.

1. Open **Terminal** (Applications > Utilities > Terminal, or press `⌘Space`
   and type `Terminal`).
2. Type this and press Return:

   ```bash
   xcode-select --install
   ```

3. If a dialog appears, click **Install** and accept the licence. The download
   is a few gigabytes and takes several minutes.
4. If Terminal instead prints `command line tools are already installed`, you
   already have them. Carry on.

### 2. Install Node.js

FlowShark needs Node.js 20 or later.

1. Check whether you already have it:

   ```bash
   node --version
   ```

2. If that prints `v20.` or higher, skip to the next step.
3. Otherwise download the **LTS** installer for macOS from
   <https://nodejs.org/>, open the `.pkg` file, and follow the installer.
4. Close and reopen Terminal, then run `node --version` again to confirm.

### 3. Install Rust

1. Check whether you already have it:

   ```bash
   cargo --version
   ```

2. If that prints a version, skip to the next step.
3. Otherwise run:

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

4. When the installer asks, press Return to accept the standard installation.
5. Close and reopen Terminal, then confirm:

   ```bash
   cargo --version
   ```

### 4. Get the source code

**With Git** (recommended, because you can pull updates later):

```bash
cd ~/Developer 2>/dev/null || cd ~
git clone https://github.com/johnjanney/flowshark-mac.git
cd flowshark-mac
```

**Without Git**, download a ZIP instead:

1. Open <https://github.com/johnjanney/flowshark-mac>.
2. Click the green **Code** button, then **Download ZIP**.
3. Double-click the downloaded ZIP to unpack it.
4. Drag the unpacked `flowshark-mac-main` folder somewhere sensible, such as
   your home folder.
5. In Terminal, move into it — type `cd ` (with a trailing space), then drag
   the folder from the Finder onto the Terminal window, then press Return.

### 5. Install the dependencies

From inside the project folder:

```bash
npm install
```

This downloads the front-end packages. It takes a minute or two and prints a
summary when it finishes.

### 6. Build the application

```bash
npm run tauri:build
```

The first build compiles the whole Rust dependency tree and takes roughly
10–20 minutes. Later builds take under a minute. The command finishes with a
line naming the files it produced.

You will find them here:

```
src-tauri/target/aarch64-apple-darwin/release/bundle/macos/FlowShark.app
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/FlowShark_0.1.0_aarch64.dmg
```

### 7. Install it

Either open the `.dmg` and drag FlowShark to Applications as in Option A, or
copy the app straight across:

```bash
cp -R src-tauri/target/aarch64-apple-darwin/release/bundle/macos/FlowShark.app /Applications/
```

### 8. Open it

Because you built it yourself, the app is **not signed with a Developer ID**
and **not notarised**. macOS will refuse to open it on the first attempt.
Follow the next section once; after that it opens normally.

---

## Opening an unsigned build

A build you made yourself has no Apple signature, so Gatekeeper stops it the
first time. This is expected. Use whichever method you prefer.

### Method 1 — Open from the shortcut menu

1. Open the **Applications** folder in the Finder.
2. **Control-click** (or right-click) **FlowShark**.
3. Choose **Open** from the menu.
4. In the dialog that appears, click **Open** again.

macOS remembers the choice. From then on, double-clicking works.

> If the dialog only offers **Done** and no **Open** button, use Method 2.

### Method 2 — Allow it in System Settings

1. Try to open FlowShark by double-clicking it. macOS blocks it.
2. Open  > **System Settings** > **Privacy & Security**.
3. Scroll to the **Security** section. A message names FlowShark.
4. Click **Open Anyway**.
5. Authenticate with Touch ID or your password.
6. Open FlowShark again and click **Open**.

### Method 3 — Remove the quarantine flag in Terminal

Use this only for an app you built yourself from source you trust.

```bash
xattr -d com.apple.quarantine /Applications/FlowShark.app
```

The command prints nothing when it succeeds.

---

## Signing your own builds (optional)

If you have an Apple Developer account and want builds that open with no
warning on any Mac:

1. In the Apple Developer portal, create a **Developer ID Application**
   certificate and install it in your login keychain.
2. Find its full name:

   ```bash
   security find-identity -v -p codesigning
   ```

   Look for a line like
   `Developer ID Application: Your Name (ABCDE12345)`.
3. Create an app-specific password at <https://appleid.apple.com> under
   **Sign-In and Security > App-Specific Passwords**.
4. Set these before building:

   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (ABCDE12345)"
   export APPLE_ID="you@example.com"
   export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"   # the app-specific password
   export APPLE_TEAM_ID="ABCDE12345"
   npm run tauri:build
   ```

Tauri signs the bundle, submits it to Apple for notarisation, waits for the
result, and staples the ticket to the app. Expect notarisation to add a few
minutes.

To have GitHub Actions do this for you on every tagged release, see
[VERSIONING.md](VERSIONING.md#ci-secrets).

---

## Making FlowShark open `.flowshark` files

Once FlowShark is in your Applications folder, macOS registers the document
type automatically. Double-clicking a `.flowshark` file opens it, and the file
shows the FlowShark document icon.

If a `.flowshark` file opens in another application, set FlowShark as the
default:

1. Control-click the `.flowshark` file in the Finder.
2. Choose **Get Info**.
3. Under **Open with**, choose **FlowShark**.
4. Click **Change All…**, then **Continue**.

> The Finder caches icons aggressively. If the document icon looks wrong after
> a fresh install, log out and back in, or run
> `killall Finder` in Terminal.

---

## Updating

**A release build:** download the newer `.dmg` and drag the new FlowShark over
the old one in Applications, replacing it.

**A build from source:**

```bash
cd flowshark-mac
git pull
npm install
npm run tauri:build
cp -R src-tauri/target/aarch64-apple-darwin/release/bundle/macos/FlowShark.app /Applications/
```

FlowShark has no built-in updater in this release.

## Uninstalling

1. Drag **FlowShark** from Applications to the Trash.
2. Optionally remove its preferences:

   ```bash
   rm -rf ~/Library/WebKit/com.flowshark.app
   rm -rf ~/Library/Application\ Support/com.flowshark.app
   rm -rf ~/Library/Caches/com.flowshark.app
   ```

Your `.flowshark` documents are ordinary files wherever you saved them and are
not touched.

---

## Troubleshooting

### "FlowShark is damaged and can't be opened"

macOS says this about an unsigned app whose quarantine flag is set, even when
nothing is wrong with it. Use
[Method 3](#method-3--remove-the-quarantine-flag-in-terminal).

### "You can't open the application because it is not supported on this Mac"

The build is for Apple Silicon and this is an Intel Mac. FlowShark does not
support Intel Macs — see
[DECISIONS.md](DECISIONS.md#d-001-apple-silicon-only).

### `npm install` fails with a permissions error

Do not use `sudo`. Instead reinstall Node.js from the official installer at
<https://nodejs.org/>, which sets up a directory npm can write to.

### `npm run tauri:build` fails with `linker 'cc' not found`

The Xcode Command Line Tools are missing. Run `xcode-select --install` and try
again.

### `npm run tauri:build` fails with `target 'aarch64-apple-darwin' not found`

Add the target and retry:

```bash
rustup target add aarch64-apple-darwin
```

### The build fails part-way through with no clear error

Clear the caches and rebuild:

```bash
rm -rf node_modules dist src-tauri/target
npm install
npm run tauri:build
```

### The window is blank when the app opens

Rebuild the front end and the app together:

```bash
npm run build && npm run tauri:build
```

If it is still blank, run `npm run tauri:dev` and look for errors in the
Terminal output.

### Notarisation fails or hangs

Check the log Apple returns:

```bash
xcrun notarytool history --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"
xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD"
```

The usual cause is an embedded binary that was not signed. Confirm the
hardened runtime and entitlements are in place:

```bash
codesign -dv --entitlements - /Applications/FlowShark.app
```

### Something else

Open an issue at
<https://github.com/johnjanney/flowshark-mac/issues> with your macOS version,
your Mac model, and the full output of the command that failed.
