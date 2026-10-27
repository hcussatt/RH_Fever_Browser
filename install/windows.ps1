# Install everything needed to build and run the games on Windows, except the game itself.
# In File Explorer, right-click this file and choose "Run with PowerShell".
#
# The build is a set of POSIX shell scripts, so on Windows it runs in Ubuntu under WSL
# (Windows Subsystem for Linux, from Microsoft). This script:
#   1. Installs WSL with Ubuntu (wsl --install, from Microsoft) if it is not there yet.
#      Windows may ask for administrator rights and a restart; run this script again after.
#   2. Installs Python 3, venv, Git, curl, unzip and xz from Ubuntu's apt repositories.
#   3. Copies this repository into your Ubuntu home folder (~/RH_Fever_Browser): building
#      there is much faster than on the Windows drive.
#   4. Runs install/finish.sh there: numpy, Pillow and cryptography from PyPI, the decomp
#      submodule from GitHub, Emscripten 5.0.7 (with Node.js) from Emscripten's official
#      GitHub and storage.googleapis.com, and the PowerPC binutils from
#      github.com/encounter/gc-wii-binutils.
# Nothing from the game is downloaded: you supply your own ISO to ./build.sh afterwards.
$ErrorActionPreference = 'Stop'
$distro = 'Ubuntu'
$repoUrl = 'https://github.com/hcussatt/RH_Fever_Browser.git'
$repo = Split-Path -Parent $PSScriptRoot

function Test-Ubuntu {
  # True when Ubuntu runs under WSL. Its error text is not an error for this script.
  $ErrorActionPreference = 'Continue'
  & wsl.exe -d $distro -e true 2>&1 | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Invoke-Wsl {
  # Run a command in Ubuntu and stop if it fails.
  & wsl.exe -d $distro @args
  if ($LASTEXITCODE -ne 0) { throw "This step failed in Ubuntu (exit code $LASTEXITCODE): $args" }
}

Write-Host '== Windows Subsystem for Linux with Ubuntu'
if (-not (Test-Ubuntu)) {
  Write-Host 'Installing WSL and Ubuntu. Windows asks for administrator rights.'
  Write-Host 'When Ubuntu opens for the first time it asks you to pick a username and password; remember the password.'
  Start-Process wsl.exe -ArgumentList '--install', '-d', $distro -Verb RunAs -Wait
  if (-not (Test-Ubuntu)) {
    Write-Host ''
    Write-Host 'WSL is installed but needs a restart before Ubuntu can run.'
    Write-Host 'Restart Windows, then run install\windows.ps1 again (right-click, Run with PowerShell) to finish.'
    exit 0
  }
}

Write-Host '== Python, Git, curl, unzip (from Ubuntu apt)'
Invoke-Wsl -u root -e apt-get update
Invoke-Wsl -u root -e env DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv python3-pip git curl unzip xz-utils ca-certificates
Invoke-Wsl -e python3 -c 'import sys; sys.exit(sys.version_info < (3,10))'

Write-Host '== Repository in Ubuntu (~/RH_Fever_Browser)'
& wsl.exe -d $distro -e sh -c 'test -d ~/RH_Fever_Browser/.git'
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Already there; using it as it is.'
} elseif (Test-Path (Join-Path $repo '.git')) {
  # Clone from this Windows checkout, so no GitHub sign-in is needed, then point origin at GitHub.
  $src = (& wsl.exe -d $distro -e wslpath -a $repo | Out-String).Trim()
  Invoke-Wsl -e sh -c "cd ~ && git -c safe.directory='*' clone '$src' RH_Fever_Browser"
  $origin = (& wsl.exe -d $distro -e git -c 'safe.directory=*' -C $src remote get-url origin | Out-String).Trim()
  if (-not $origin) { $origin = $repoUrl }
  Invoke-Wsl -e sh -c "cd ~/RH_Fever_Browser && git remote set-url origin '$origin'"
} else {
  Write-Host 'This folder is not a Git checkout, so the repository is cloned from GitHub (it may ask you to sign in).'
  Invoke-Wsl -e sh -c "cd ~ && git clone '$repoUrl' RH_Fever_Browser"
}

Write-Host '== Python packages, Emscripten and PowerPC binutils'
Invoke-Wsl -e sh -c 'cd ~/RH_Fever_Browser && exec sh install/finish.sh /usr/bin/python3'

Write-Host ''
Write-Host 'Done. To build and play, open Ubuntu from the Start menu and run (your C: drive is /mnt/c):'
Write-Host ''
Write-Host '  cd ~/RH_Fever_Browser'
Write-Host '  ./build.sh "/mnt/c/Users/<you>/Downloads/Rhythm Heaven Fever (USA).iso"'
Write-Host '  ./serve.sh --open'
Write-Host ''
Write-Host 'The page opens in your Windows browser (Chrome recommended).'
