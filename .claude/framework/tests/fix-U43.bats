#!/usr/bin/env bats
# U43 regression fixtures for block-dangerous-commands.py: compound shell
# syntax, wrapper option values, .exe suffixes, canonical protected targets,
# alternate wipe tools, `--recu`, line continuations, `function f {}` fork
# bombs, and the PowerShell / Monitor tool coverage of the kernel guard.

load helpers

setup() {
  init_repo
}

# _guard <tool_name> <command> — run the guard on a JSON event built by
# Python (no hand-escaping of backslashes / quotes in the fixtures).
_guard() {
  local ev
  ev=$("$PYTHON" -c 'import json,sys; print(json.dumps({"tool_name": sys.argv[1], "tool_input": {"command": sys.argv[2]}}))' "$1" "$2")
  pyrun "$HOOKS/block-dangerous-commands.py" "$ev"
}

# _expect <status> <tool_name> <command>...
_expect() {
  local want="$1" tool="$2" c
  shift 2
  for c in "$@"; do
    run _guard "$tool" "$c"
    if [ "$status" -ne "$want" ]; then
      echo "expected $want, got $status for [$tool] $c" >&2
      return 1
    fi
  done
}

@test "U43 guard: compound shell syntax no longer hides rm" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'if true; then rm -rf ~; fi' 'for i in 1; do rm -rf ~; done' \
    '( rm -rf ~ )' '(rm -rf ~)' '{ rm -rf ~; }' '! rm -rf ~' 'exec rm -rf ~' \
    'builtin rm -rf ~' 'coproc rm -rf ~' 'eval rm -rf ~' "eval 'rm -rf ~'" \
    'echo $(rm -rf ~)' 'echo `rm -rf ~`' 'case x in a) rm -rf ~;; esac' \
    'if [ -d build ]; then rm -rf /; fi'
}

@test "U43 guard: wrapper option values are consumed (sudo -u, timeout -s, env -u)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'sudo -u root rm -rf /' 'doas -u root rm -rf /' \
    'timeout -s KILL 5 rm -rf ~' 'env -u FOO rm -rf ~' 'nice -n 5 rm -rf /' \
    'busybox rm -rf /'
}

@test "U43 guard: Windows executable suffixes are stripped" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'rm.exe -rf /c' 'RM.EXE -rf /' 'format.com C:'
}

@test "U43 guard: protected targets are canonicalised" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'rm -rf ~//' 'rm -rf /*/' 'rm -rf "$USERPROFILE"' \
    'rm -rf "$HOME/."' 'cd / && rm -rf *' 'cd ~ && rm -rf .' \
    'rm -rf /./*' 'rm -rf ~/./*' 'find /. -delete' 'rm -rf /./' 'rm -rf /.' \
    'rm -rf /././/./*'
  _expect 0 Bash 'rm -rf /tmp/./x' 'rm -rf ~/./proj' 'rm -rf ./build'
}

@test "U43 guard: the expanded absolute home path is protected" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash "rm -rf $HOME" "rm -rf $HOME/"
}

@test "U43 guard: alternate wipe tools and forms are blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'find ~ -delete' 'find / -type f -delete' 'find / -exec rm -rf {} +' \
    'rsync -a --delete empty/ ~/' 'echo x &>/dev/sda' 'dd if=/dev/zero of=/dev/xvda' \
    'dd if=/dev/zero of='"'"'\\.\PhysicalDrive0'"'" 'mkswap /dev/sdb'
}

@test "U43 guard: abbreviated --recu, line continuation, function-keyword fork bomb" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'rm --recu --force /' "$(printf 'rm -rf \\\n~')" \
    'function f { f | f & }; f' 'function f() { f|f& }; f'
}

@test "U43 guard: PowerShell tool destructive forms are blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 PowerShell 'Remove-Item -Recurse -Force $HOME' 'Remove-Item -Recurse -Force C:\' \
    'rm -r -fo C:\' 'Remove-Item C:\ -Recurse' 'Remove-Item -Path:C:\ -Recurse' \
    'Remove-Item -Recurse $env:USERPROFILE' 'ri -r ~' 'Format-Volume -DriveLetter D' \
    'Clear-Disk -Number 1 -RemoveData' 'if ($true) { Remove-Item -Recurse -Force C:\ }' \
    'Get-Item x | ForEach-Object { Remove-Item -Recurse ~ }' \
    "$(printf 'Remove-Item -Recurse `\n -Force C:\\')" 'Set-Location C:\; Remove-Item * -Recurse' \
    '& rm.exe -rf /'
}

@test "U43 guard: brace-attached PowerShell script blocks and Invoke-Expression are judged" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 PowerShell 'if ($true) {Remove-Item -Recurse -Force C:\}' \
    '1 | % {Remove-Item -Recurse ~}' 'Invoke-Expression "Remove-Item -Recurse C:\"' \
    'iex "Remove-Item -Recurse C:\"' 'Invoke-Expression -Command "Remove-Item -Recurse C:\"'
  _expect 0 PowerShell 'Get-ChildItem | % {$_.Name}' '$h = @{a=1}; Write-Output $h' \
    'iex "Get-Date"' 'Remove-Item -Recurse ${env:TEMP}\build'
}

@test "U43 guard: cd - (OLDPWD) is not treated as a bare cd home" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 0 Bash 'cd - && rm -rf *'
  _expect 2 Bash 'cd && rm -rf *'
}

@test "U43 guard: Monitor tool commands are screened as shell" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Monitor 'rm -rf ~'
  _expect 0 Monitor 'npm test'
}

@test "U43 guard: ordinary commands stay allowed (no false positives)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 0 Bash 'if [ -d build ]; then rm -rf build; fi' 'for f in *.log; do rm -f "$f"; done' \
    '( cd sub && make )' '{ echo a; echo b; } > out.txt' 'echo $(date)' 'echo $((1+2))' \
    "find . -name '*.pyc' -delete" "find ~ -name '*.pyc' -delete" 'find ~/proj -delete' \
    'find . -type f -exec rm {} \;' 'rsync -a --delete src/ dest/' 'rsync -a src/ ~/' \
    'cd /tmp && rm -rf *' 'cd ~/proj && rm -rf *' 'sudo -u root ls /' \
    'git commit -m "if true; then rm -rf ~; fi"' 'rm -rf ~/proj/build' \
    'cmd 2>&1 | tee log.txt' 'function greet { echo hi | cat & }; greet' \
    'echo hi >/dev/null' 'xargs -n 1 echo'
  _expect 0 PowerShell 'Remove-Item -Force C:\temp\x' 'Remove-Item -Recurse -Force .\build' \
    'Get-ChildItem C:\ | Select-Object Name' 'rm -Force C:\' 'Remove-Item -Recurse:$false C:\' \
    "Write-Output 'Remove-Item -Recurse C:\\'"
}

@test "U43 kernel: guard registered for Bash, PowerShell and Monitor; copy byte-identical" {
  local hj="$BATS_TEST_DIRNAME/../../../plugins/ccmaf-kernel/hooks/hooks.json"
  [ -f "$hj" ] || skip "kernel plugin not present"
  grep -q '"matcher": "Bash|PowerShell|Monitor"' "$hj"
  cmp -s "$BATS_TEST_DIRNAME/../../hooks/block-dangerous-commands.py" \
    "$BATS_TEST_DIRNAME/../../../plugins/ccmaf-kernel/scripts/block-dangerous-commands.py"
}

# --- CHANGES-REQUESTED round: `..`, home ancestors, clustered flags,
# interpreters, PowerShell spellings / pipelines, heredocs ------------------

@test "U43 guard: absolute and ~-anchored '..' spellings of root / home / home's parent are blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'rm -rf /..' 'rm -rf /usr/..' 'rm -rf /tmp/../' 'rm -rf ~/..' \
    'rm -rf ~/.claude/..' 'rm -rf $HOME/..' 'rm -rf ~/a/../..' \
    'cd /tmp/.. && rm -rf *' 'cd ~/.. && rm -rf *' 'cd /usr/.. && rm -rf ./*'
  _expect 2 PowerShell 'Remove-Item -Recurse C:\Windows\..'
  _expect 0 Bash 'rm -rf ~/project/../other/build' 'rm -rf /tmp/a/../b' 'rm -rf ../build'
}

@test "U43 guard: an ANCESTOR of home (/home, /Users, /c/Users, C:\\Users) is protected" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'rm -rf /home' 'rm -rf /home/' 'rm -rf /home/*' 'rm -rf /Users' \
    'rm -rf /Users/*' 'rm -rf /c/Users' 'rm -rf /mnt/c/Users'
  _expect 2 PowerShell 'Remove-Item -Recurse C:\Users' 'Remove-Item -Recurse -Force "C:\Users\*"'
  _expect 0 Bash 'ls /home' 'rm -rf /home/x/../y/build/../../z/tmp'
}

@test "U43 guard: a clustered wrapper flag whose last letter takes a value consumes it" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'sudo -iu root rm -rf /' 'sudo -Eu root rm -rf /' 'sudo -nu root rm -rf ~'
  _expect 0 Bash 'sudo -iu root ls /'
}

@test "U43 guard: bash/sh -c, pwsh -Command and cmd /c payloads are re-judged (both tools)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash "bash -c 'rm -rf /'" 'sh -c "rm -rf ~"' 'bash -lc "rm -rf /"' \
    'sh -c -- "rm -rf ~"' 'zsh -c "cd / && rm -rf *"' 'pwsh -Command "Remove-Item -Recurse ~"'
  _expect 2 PowerShell 'bash -c "rm -rf /"' 'powershell -c "Remove-Item -Recurse C:\"' \
    'pwsh -NoProfile -Command Remove-Item -Recurse -Force ~' 'cmd /c "rd /s /q C:\"' \
    'cmd /c rd /s /q C:\' 'cmd /k rd /s /q C:\'
  _expect 0 Bash 'bash -c "npm test"' 'bash script.sh' 'python -c "import os; print(1)"'
  _expect 0 PowerShell 'pwsh -Command "Get-ChildItem"' 'cmd /c dir C:\'
}

@test "U43 guard: PowerShell dot-source, drive-root env vars, pipelines and subexpressions" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 PowerShell '. Remove-Item -Recurse C:\' '. rm -r -fo ~' \
    'Remove-Item -Recurse -Path $env:HOMEDRIVE\' 'Remove-Item -Recurse $env:SystemDrive\' \
    'Remove-Item -Recurse "%SystemDrive%\"' 'Remove-Item -Recurse ${env:HOMEDRIVE}\*' \
    'Get-ChildItem C:\ | Remove-Item -Recurse -Force' 'gci ~ | Remove-Item -Recurse -Force' \
    'Get-ChildItem C:\ | ForEach-Object { Remove-Item -Recurse $_ }' \
    'Remove-Item -Recurse (Get-Item ~)' 'Remove-Item -Recurse -Force (Get-ChildItem C:\)'
  _expect 0 PowerShell 'Get-ChildItem .\dist | Remove-Item -Recurse -Force' \
    'gci ~ | Select-Object Name' '. .\build.ps1' 'Remove-Item -Recurse (Join-Path $PWD dist)'
}

@test "U43 guard: xargs fed a protected listing, \$(...) targets and brace-expansion globs over home" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'echo / | xargs rm -rf' 'ls ~ | xargs rm -rf' \
    'find / -maxdepth 1 | xargs -0 rm -rf' 'rm -rf $(echo ~)' 'rm -rf ~/{*,.*}' \
    'rm -rf /{*,.*}' 'rm -rf $HOME/{*,.[!.]*}'
  _expect 0 Bash 'rm -rf ~/{build,dist}' 'ls build | xargs rm -rf' 'echo ~ | xargs ls'
}

@test "U43 guard: data heredocs (commit messages) are skipped; heredocs fed to a shell are judged" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 0 Bash $'git commit -m "$(cat <<\'EOF\'\nfix: guard blocks rm -rf / and rm -rf ~\n\nAlso cd / && rm -rf *\nEOF\n)"' \
    $'cat > notes.md <<EOF\nrm -rf ~\nEOF' $'cat <<-EOF\n\trm -rf /\n\tEOF' \
    $'cat <<"EOF" > x.sh\nsudo rm -rf /\nEOF\nnpm test' 'cat <<<"rm -rf /"'
  _expect 2 Bash $'bash <<EOF\nrm -rf /\nEOF' $'cat <<EOF | sh\nrm -rf ~\nEOF' \
    $'sudo bash <<"EOF"\nrm -rf /\nEOF' $'cat <<EOF\nhello\nEOF\nrm -rf /' \
    $'cat <<EOF\nrm -rf / with no terminator'
}

@test "U43 settings: a project settings.json that registers the v1 guard does so for PowerShell|Monitor too" {
  [ -n "$PYTHON" ] || skip "python not available"
  local sj="$BATS_TEST_DIRNAME/../../settings.json"
  [ -f "$sj" ] || skip "no project settings.json"
  grep -q 'block-dangerous-commands.py' "$sj" || skip "this project does not register the v1 guard (plugin-lane repo)"
  run "$PYTHON" -c '
import json, sys
groups = json.load(open(sys.argv[1], encoding="utf-8")).get("hooks", {}).get("PreToolUse", [])
hooks = [(g.get("matcher"), h.get("command", "")) for g in groups for h in g.get("hooks", [])]
def guarded(m):
    return any(mm == m and "block-dangerous-commands.py" in c for mm, c in hooks)
assert guarded("Bash"), "guard not registered for Bash"
assert guarded("PowerShell|Monitor"), "guard not registered for PowerShell|Monitor"
assert not any("this Bash command was NOT screened" in c for _, c in hooks), "skip message not tool-neutral"
' "$sj"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# --- Round 3: system dirs, mv, recursive permission rewrites, device writers

@test "U43 guard: recursive delete of a core system dir AT the root is blocked; deeper paths are not" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'rm -rf /etc' 'rm -rf /usr' 'rm -rf /bin' 'rm -rf /sbin' 'rm -rf /lib' \
    'rm -rf /lib64' 'rm -rf /var' 'rm -rf /boot' 'rm -rf /opt' 'rm -rf /System' \
    'rm -rf /Library' 'rm -rf /Applications' 'rm -rf /private' 'rm -rf /etc/*' \
    'rm -rf /usr/local/..' 'rm -r /var/' 'cd /etc && rm -rf *' 'sudo rm -rf /usr/*' \
    'rm -rf /c/Windows' 'rm -rf "/c/Program Files"'
  _expect 2 PowerShell 'Remove-Item -Recurse -Force C:\Windows' \
    'Remove-Item -Recurse "C:\Program Files"' 'Remove-Item -Recurse "C:\Program Files (x86)\*"' \
    'Remove-Item -Recurse C:\ProgramData' 'rd /s /q C:\Windows'
  _expect 0 Bash 'rm -rf /usr/local/src/myproj/build' 'rm -rf /var/tmp/x' 'rm -rf ./etc' \
    'rm -rf lib' 'rm -rf opt/cache' 'rm -rf /opt/myapp/logs' 'rm -rf /tmp/build' 'ls /etc'
  _expect 0 PowerShell 'Remove-Item -Recurse C:\ProgramData\MyApp\cache' \
    'Remove-Item -Recurse "C:\Program Files\MyApp\tmp"'
}

@test "U43 guard: mv / Move-Item of root, home or a system dir to anywhere is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'mv / /tmp/x' 'mv ~ /tmp/oldhome' 'mv $HOME/ /mnt/x' 'mv /etc /etc.bak' \
    'mv -t /tmp /usr' 'sudo mv /home /x'
  _expect 2 PowerShell 'Move-Item C:\Windows D:\old' 'Move-Item -Path ~ -Destination D:\bak'
  _expect 0 Bash 'mv a.txt b.txt' 'mv build /tmp/old-build' 'mv x.conf /etc/' 'mv ~/a ~/b'
  _expect 0 PowerShell 'Move-Item .\a.txt .\b.txt' 'move /y a.txt b.txt'
}

@test "U43 guard: recursive chmod/chown/chgrp, icacls /T, Set-Acl -Recurse, takeown /r on protected roots" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'chmod -R 000 /' 'chmod -R 777 ~' 'chown -R nobody /' 'sudo chown -R me:me /usr' \
    'chgrp -R staff /etc' 'chmod --recursive a-rwx $HOME'
  _expect 2 PowerShell 'icacls C:\ /reset /T' 'icacls C:\Windows /grant Everyone:F /T' \
    'Set-Acl -Path C:\ -AclObject $acl -Recurse' 'takeown /f C:\Windows /r'
  _expect 0 Bash 'chmod -R u+w ./dist' 'chmod 755 script.sh' 'chmod -r file' \
    'chown -R me ~/project' 'chmod +x ~/bin/tool'
  _expect 0 PowerShell 'icacls C:\ /T' 'icacls .\dist /reset /T' 'Set-Acl -Path .\x.txt -AclObject $acl'
}

@test "U43 guard: truncate / cp / redirect onto a whole block device is blocked; reading one is not" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash 'truncate -s0 /dev/sda' 'truncate -s 0 /dev/nvme0n1' 'cp /dev/zero /dev/sda' \
    'cp image.iso /dev/disk2' 'cp -t /dev/sdb image.iso' 'cat image.iso > /dev/sdb' \
    'cat /dev/urandom >> /dev/nvme0n1p1'
  _expect 2 PowerShell 'Copy-Item disk.img \\.\PhysicalDrive1'
  _expect 0 Bash 'cp file /dev/null' 'truncate -s0 ./log.txt' 'cp /dev/sda disk.img' \
    'cat /dev/sda > disk.img' 'cp a b' 'echo x > /dev/null'
}

@test "U43 guard: git history operations are deliberately NOT judged (documented scope)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 0 Bash 'git push --force origin main' 'git push -f' 'git reset --hard HEAD~5' 'git clean -fdx'
}

# --- Round 4: heredoc skip is an ALLOWLIST (fail-closed) -------------------

@test "U43 guard: a heredoc inside \$(…) whose output is EXECUTED is judged (bash -c / sh -c / eval)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash $'bash -c "$(cat <<\'EOF\'\nrm -rf /\nEOF\n)"' \
    $'eval "$(cat <<EOF\nrm -rf /\nEOF\n)"' $'sudo sh -c "$(cat <<EOF\nrm -rf /\nEOF\n)"' \
    $'echo "$(cat <<EOF\nx\nEOF\n)" && rm -rf ~'
}

@test "U43 guard: heredocs fed to source/. /dev/stdin, bash -, xargs bash -c, or a pipe to a shell are judged" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash $'source /dev/stdin <<EOF\nrm -rf /\nEOF' $'. /dev/stdin <<EOF\nrm -rf /\nEOF' \
    $'bash - <<EOF\nrm -rf /\nEOF' $'bash /dev/stdin <<EOF\nrm -rf /\nEOF' \
    $'sudo -u root bash <<EOF\nrm -rf /\nEOF' $'cat <<EOF | xargs -0 bash -c\nrm -rf /\nEOF' \
    $'cat <<EOF | tee log | bash\nrm -rf /\nEOF' $'cat <<EOF | sudo -E bash\nrm -rf /\nEOF' \
    $'cat <<EOF >x.sh; bash x.sh\nrm -rf /\nEOF' $'python3 - <<EOF\nx\nEOF\nrm -rf /'
}

@test "U43 guard: '<<WORD' inside quotes, after a # comment or inside \$((…)) hides nothing" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash $'echo "x <<EOF"\nrm -rf /\nEOF' $'echo hi # <<EOF\nrm -rf /\nEOF' \
    $'echo \'<<EOF\'\nrm -rf ~\nEOF' $'# <<EOF\nrm -rf /' $'echo $((1<<EOF))\nrm -rf /' \
    $'cat <<EOF\nx\n EOF\nEOF\nrm -rf /' $'cat <<EOF >/dev/sda\nx\nEOF'
}

@test "U43 guard: allowlisted data heredocs stay allowed (messages, files, terminal, data pipes)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 0 Bash $'git commit -m "$(cat <<\'EOF\'\nguard: mv / and chmod -R 000 / now blocked\nEOF\n)"' \
    $'git commit -F - <<EOF\nrm -rf ~ fix\nEOF' \
    $'gh pr create --title x --body "$(cat <<\'EOF\'\nblocks rm -rf / now\nEOF\n)"' \
    $'cat <<EOF >> ~/.bashrc\nexport PATH=/x:$PATH\nEOF' $'cat <<EOF > script.sh\nrm -rf /\nEOF' \
    $'cat <<EOF\nsudo rm -rf /\nEOF' $'cat <<EOF | kubectl apply -f -\nrm -rf /\nEOF' \
    $'tee notes.txt <<EOF\nrm -rf ~\nEOF' $'bash <<EOF\nnpm test\nEOF' $'python3 - <<EOF\nprint(1)\nEOF'
}

@test "U43 guard: Windows system-folder env spellings, empty brace alternatives, install onto a device" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 PowerShell 'Remove-Item -Recurse -Force $env:windir' \
    'Remove-Item -Recurse -Force $env:SystemRoot' 'Remove-Item -Recurse -Force $env:ProgramFiles' \
    'Remove-Item -Recurse -Force "${env:ProgramFiles(x86)}"' \
    'Remove-Item -Recurse -Force ${env:ProgramFiles(x86)}' 'Remove-Item -Recurse $env:ProgramData\*' \
    'Remove-Item -Recurse $env:CommonProgramFiles' 'rd /s /q %WINDIR%' 'rd /s /q %SystemRoot%' \
    'Remove-Item -Recurse "%ProgramFiles%"' 'Remove-Item -Recurse "%ProgramFiles(x86)%"' \
    'Remove-Item -Recurse "%ProgramData%"'
  _expect 2 Bash 'rm -rf ~/{,.}*' 'rm -rf ~/.*' 'install -m 644 /dev/zero /dev/sda'
  _expect 0 PowerShell 'Remove-Item -Recurse $env:ProgramData\MyApp\cache' 'Remove-Item -Recurse ${env:TEMP}\x'
  _expect 0 Bash 'rm -rf ~/{a,b}/build' 'rm -rf ~/.cache/*' 'install -m 755 tool /usr/local/bin/tool'
}

# --- Round 5: guard-internal errors fail CLOSED; heredoc sink escapes ------

# _guard_patched <mode> <command> — run the REAL guard source with one
# function monkeypatched to raise, driving the real top-level decision block.
_guard_patched() {
  cat > "$BATS_TEST_TMPDIR/patched.py" <<'PY'
import io, json, sys
src = open(sys.argv[1], encoding="utf-8").read()
mode, cmd = sys.argv[2], sys.argv[3]
head, marker, tail = src.partition("# --- The decision:")
assert marker, "decision marker missing from the guard"
sys.stdin = io.StringIO(json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}}))
ns = {"__name__": "guard_under_test"}
exec(compile(head, "guard", "exec"), ns)
def boom(*a, **k):
    raise TypeError("injected")
if mode == "is_data":
    def raiser(*a, **k):
        raise RuntimeError("injected")
    ns["_heredoc_is_data"] = raiser
elif mode == "scan":
    ns["_scan_heredocs"] = boom
elif mode == "catastrophic_once":
    real, calls = ns["_is_catastrophic"], []
    def once(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise KeyError("injected")
        return real(*a, **k)
    ns["_is_catastrophic"] = once
elif mode == "catastrophic_always":
    ns["_is_catastrophic"] = boom
try:
    exec(compile(marker + tail, "guard", "exec"), ns)
    code = 0
except SystemExit as e:
    code = e.code or 0
sys.exit(code)
PY
  ( cd "$REPO" && "$PYTHON" "$BATS_TEST_TMPDIR/patched.py" "$HOOKS/block-dangerous-commands.py" "$1" "$2" )
}

@test "U43 guard: _heredoc_is_data or _scan_heredocs raising still judges the heredoc body" {
  [ -n "$PYTHON" ] || skip "python not available"
  local body=$'cat <<EOF > notes.md\nrm -rf /\nEOF'
  run _guard "Bash" "$body"            # unpatched: a data sink -> allowed
  [ "$status" -eq 0 ]
  run _guard_patched is_data "$body"
  [ "$status" -eq 2 ]
  run _guard_patched scan "$body"
  [ "$status" -eq 2 ]
  run _guard_patched scan $'git commit -m "$(cat <<\'EOF\'\nrm -rf ~\nEOF\n)"'
  [ "$status" -eq 2 ]
}

@test "U43 guard: an unexpected error retries once without heredoc skipping, else warns NOT screened" {
  [ -n "$PYTHON" ] || skip "python not available"
  run _guard_patched catastrophic_once 'rm -rf /'
  [ "$status" -eq 2 ]
  run _guard_patched catastrophic_once 'ls'
  [ "$status" -eq 0 ]
  run _guard_patched catastrophic_always 'rm -rf /'
  [ "$status" -eq 1 ]
  [[ "$output" == *"block-dangerous-commands guard ERROR"* ]]
  [[ "$output" == *"NOT screened"* ]]
}

@test "U43 guard: a data sink writing to an executing target is judged (>(sh), /dev/stdout, /dev/fd, /proc/self/fd)" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash $'tee >(bash) <<EOF\nrm -rf /\nEOF' $'cat <<EOF > >(sh)\nrm -rf /\nEOF' \
    $'cat <<EOF >/dev/stdout | bash\nrm -rf /\nEOF' $'tee /dev/fd/1 <<EOF | sh\nrm -rf /\nEOF' \
    $'cat <<EOF > /proc/self/fd/1 | bash\nrm -rf /\nEOF' $'cat <<EOF >/dev/stdout\nrm -rf /\nEOF'
}

@test "U43 guard: a message heredoc is judged when the same line can re-run it, or nests a non-sink consumer" {
  [ -n "$PYTHON" ] || skip "python not available"
  local msg=$'git commit -m "$(cat <<\'EOF\'\nrm -rf / fix\nEOF\n)"'
  _expect 2 Bash "$msg ; eval \"\$(git log -1 --format=%B)\"" \
    "$msg && git log -1 --format=%B | bash" "$msg; sh -c \"\$(git log -1 --format=%B)\"" \
    $'git commit -m "x"; bash -c "$(cat <<EOF\nrm -rf /\nEOF\n)"' \
    $'git commit -m "$(bash <<EOF\nrm -rf /\nEOF\n)"' $'git commit -m "$(sh <<\'EOF\'\nrm -rf /\nEOF\n)"' \
    $'git commit -m "$(eval "$(cat <<EOF\nrm -rf /\nEOF\n)")"'
  _expect 0 Bash "$msg" "git add -A && $msg" "$msg && git push origin main"
}

@test "U43 guard: CRLF input, a mixed-indent <<- terminator and delimiter variants never hide lines" {
  [ -n "$PYTHON" ] || skip "python not available"
  _expect 2 Bash $'bash <<EOF\r\nrm -rf /\r\nEOF\r\n' $'cat <<EOF\r\nx\r\nEOF\r\nrm -rf /' \
    $'cat <<-EOF\n\tx\n \tEOF\nrm -rf /' $'cat <<-EOF\n\tx\n\t EOF\nrm -rf /' \
    $'cat <<E"O"F\nx\nEOF\nrm -rf /' $'cat <<$\'EOF\'\nx\nEOF\nrm -rf /' \
    $'cat <<\\EOF\nx\nEOF\nrm -rf /' $'cat <<\'\'\nx\n\nrm -rf /' $'bash <<E\'O\'F\nrm -rf /\nEOF'
  _expect 0 Bash $'cat <<E"O"F > notes.md\nrm -rf /\nEOF'
}
