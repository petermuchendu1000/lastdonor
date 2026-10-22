# 96 — Deploying by hand, from Windows

**Date:** 2026-10-22
**Trigger:** owner instruction — deploys move to the owner's own machine
(PowerShell), and auto-deploy is off while GitHub Actions is unavailable.

---

## 1. What exists now

| Script | For |
|---|---|
| `scripts/deploy.sh` | bash, agent sessions and Linux/macOS |
| `scripts/deploy.ps1` | **Windows PowerShell 5.1 and PowerShell 7** |

Both end in the same `flyctl deploy --remote-only`. The PowerShell one does
three things the bash one does not, because a manual deploy is now **the
only gate this project has**:

1. **Runs lint, typecheck and the unit suite before building.** CI has
   never executed a single job (`docs/50`), so if these do not run here,
   nothing checks the change at all.
2. **Refuses a dirty tree, a non-`main` branch, or a branch behind its
   remote** — so what ships is a commit that exists on GitHub. Each is
   overridable with an explicit switch, which makes bypassing it a
   decision rather than an accident.
3. **Reads `/api/v1/health` afterwards** and fails if `database` is not
   `ok`.

### Usage

```powershell
cd C:\path\to\lastdonor
.\scripts\deploy.ps1 -DryRun     # every check, prints the command, deploys nothing
.\scripts\deploy.ps1             # the real thing
```

| Switch | Effect |
|---|---|
| `-DryRun` | Run all checks, print the `flyctl` line, exit. **Use this first.** |
| `-Prerender` | Pass `$env:DATABASE_URL` as a BuildKit secret so `revalidate` routes pre-render real content. A read-only pooled (6543) URL is enough. |
| `-SkipGate` | Skip lint/typecheck/tests. Only for redeploying an already-green commit. |
| `-ClassicBuilder` | Disable Depot. Needed behind a TLS-inspecting proxy, where Depot's gRPC handshake dies with `x509: certificate signed by unknown authority`. |
| `-AllowDirty` / `-AllowBranch` | Bypass the git guards. |
| `-App <name>` | Target another Fly app. |

### First-time setup

```powershell
# 1. flyctl, then open a NEW terminal so PATH updates
winget install --id Fly-io.flyctl
#    or: iwr https://fly.io/install.ps1 -useb | iex

# 2. Sign in once (stores credentials in %USERPROFILE%\.fly)
fly auth login

# 3. Allow local scripts for this session only
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
```

`fly auth login` is preferred over a token. If a token is used it **must be
org-scoped**: a deploy- or builder-scoped token cannot see the app and
fails later with a confusing "app not found".

---

## 2. Two PowerShell traps the script encodes

Recorded because both produce failures that look like something else.

**`$ErrorActionPreference = 'Stop'` does not apply to native executables.**
`npm`, `git` and `flyctl` can all exit non-zero while the script carries on
to deploy. Every external call goes through `Invoke-Native`, which checks
`$LASTEXITCODE`. Without it a red test run ships.

**…and yet it *does* fire on native stderr when merged.** In Windows
PowerShell 5.1, native stderr becomes `ErrorRecord` objects; merging them
with `2>&1` while `Stop` is in force raises a terminating
`NativeCommandError`. So `fly auth whoami` when **not** signed in would
abort the script instead of reaching the friendly "run `fly auth login`"
message — the one case the check exists for. `Invoke-NativeCapture` drops
to `Continue` for the duration of the call. Both facts are true at once,
which is what makes this worth writing down.

Also: `curl` is an **alias for `Invoke-WebRequest`** on Windows and does
not accept curl's flags, so the health check calls `Invoke-RestMethod`
directly. The script targets 5.1, so it uses no ternary (`? :`) and no
null-coalescing (`??`) — both are PowerShell 7-only and fail to *parse* on
5.1, which produces an error pointing at the wrong line.

**Not executed before shipping.** There is no PowerShell in the agent
sandbox, so `deploy.ps1` was written and statically checked (brace and
here-string balance, no 7-only syntax, no `curl`, every native call
guarded) but **never run**. `-DryRun` exists so the first real invocation
proves the whole path without touching production.

### Amendment, 2026-10-22: `Test-Path node_modules` is the wrong check

Both things the first real runs caught, in order.

A fresh clone has no `node_modules`, so the gate's first step died on a
missing binary and read like a broken repository. Fixed in `81d9a85` by
installing before the gate — the setup instructions in §1 had a
`git clone` and no `npm ci`, and nothing in the script covered for it.

**That fix was incomplete**, and the hole is worth recording because the
obvious check is the broken one. It guarded on
`Test-Path node_modules`, which **passes on the partial tree a failed
`npm ci` leaves behind** — exactly the state the owner's machine was in
after the `ECONNRESET`. The script announced *"dependencies already
installed"* and the gate then failed with

```
'next' is not recognized as an internal or external command
```

which again reads like a broken repository and is again a missing install.

The test is now the **stamp**, not the directory:
`node_modules\.package-lock.json` is npm's hidden lockfile, written at the
*end* of a successful reify (verified on npm 10.9.4: present,
`lockfileVersion` 3, 1,339 packages). Its absence beside an existing
`node_modules` means the last install did not finish, so that is now a
third install trigger alongside "missing" and "lockfile newer than the
tree".

The general lesson, which applies well beyond this script: **a directory
existing is not evidence that what was supposed to fill it succeeded.**
Check for the artefact the successful path writes last.

---

## 3. ⚠️ Correction: waiting for Actions credits may not unblock CI

The instruction behind this work was that Actions is out of credit and
will recharge in ~10 days. **That is probably not what is blocking it**,
and acting on it could mean waiting for nothing.

**Verified 2026-10-22**, re-queried today:

| Fact | Evidence |
|---|---|
| Both runs in repo history failed the same way | `total_count: 2`, runs 1 and 2, no runner assigned |
| The reason is a **lock**, not a quota | annotation, verbatim: *"The job was not started because your account is locked due to a billing issue."* |
| `lastdonor` is **public** | `visibility: public` |
| Raising the spending budget did **not** clear it | tested 2026-10-21; identical annotation afterwards |

Two separate things are being conflated:

- **Included minutes** (2,000/2,000 used) do reset monthly, and that reset
  is what is ~10 days away.
- **The account lock** is a payment state. A quota reset is not a payment.
  Raising the budget already failed to lift it, which is the evidence that
  the cap is not what is holding this.

And the minutes are not this repository's problem anyway: **`lastdonor` is
public**, so its Actions usage is discounted, and it does not appear in the
spend at all — that $50 is five other private repos (`invest254`,
`CEBUPAY`, `elopis`, `handshakeai_oline`, `invest254-platform-template`).

**Assumed, not verified:** whether settling the outstanding balance lifts
the lock immediately. The account billing endpoints are blocked by the
agent sandbox's proxy, so only the owner can see the invoice.

**So:** manual deploys are the right call regardless — but expect to settle
a payment rather than wait out a clock. Nothing here depends on the answer;
`deploy.ps1` works either way, and `docs/50` is the running record.

---

## 4. Rejected

**Deploying straight from `fly deploy` with no wrapper.** It is one
command, and that is the problem: with CI dark, a bare `fly deploy` ships
whatever is in the working directory with nothing having run the tests.
The wrapper exists to make the gate the default and skipping it explicit.

**Porting the bash script line for line.** `scripts/deploy.sh` hardcodes
`--depot=false` and an `SSL_CERT_FILE` for the agent sandbox's
TLS-inspecting proxy. Neither applies on a developer machine, where Depot
is the faster default — so it is opt-*out* (`-ClassicBuilder`) on Windows
rather than always-on.

**A GitHub Actions deploy workflow.** It would not run (§3), and writing
one now would mean shipping a path nobody can exercise — the thing
`docs/81` and `docs/76` were both about.
