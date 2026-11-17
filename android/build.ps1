# Builds the Xedine Android app (ADR 0065): the signed bundle for Google Play (.aab) and a signed .apk
# to install straight on a phone for testing. Run from anywhere:
#
#   powershell -ExecutionPolicy Bypass -File E:\xedine.org\android\build.ps1
#
# Tools live on E: (C: is full): JDK 17, the Android SDK and Gradle's cache in E:\android-tools
# (set XEDINE_ANDROID_TOOLS to move them). The upload key is read from
# E:\Xedine-Android-Keys\keystore.properties (set XEDINE_KEYSTORE_PROPERTIES to move it).
# Before a new upload to Play, raise appVersionCode (and appVersion) in twa-manifest.json and run
# `node android/tools/generate-project.mjs` first: Play refuses a version code it has seen.
$ErrorActionPreference = 'Stop'
$tools = if ($env:XEDINE_ANDROID_TOOLS) { $env:XEDINE_ANDROID_TOOLS } else { 'E:\android-tools' }
$env:JAVA_HOME = "$tools\jdk-17"
$env:ANDROID_HOME = "$tools\sdk"
$env:GRADLE_USER_HOME = "$tools\gradle-home"
$env:TEMP = "$tools\tmp"
$env:TMP = "$tools\tmp"
$env:GRADLE_OPTS = "-Djava.io.tmpdir=$tools\tmp"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

Set-Location $PSScriptRoot
"sdk.dir=$($env:ANDROID_HOME -replace '\\', '/')" | Set-Content local.properties -Encoding ASCII

& .\gradlew.bat --no-daemon --console=plain clean bundleRelease assembleRelease
if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE)" }

$twa = Get-Content twa-manifest.json -Raw | ConvertFrom-Json
$name = "xedine-$($twa.appVersion)-$($twa.appVersionCode)"
New-Item -ItemType Directory -Force release | Out-Null
Copy-Item app\build\outputs\bundle\release\app-release.aab "release\$name.aab" -Force
Copy-Item app\build\outputs\apk\release\app-release.apk "release\$name.apk" -Force

# Check both are signed with the upload key whose fingerprint is in public/.well-known/assetlinks.json.
$buildTools = Get-ChildItem "$env:ANDROID_HOME\build-tools" | Sort-Object Name -Descending | Select-Object -First 1
& "$($buildTools.FullName)\apksigner.bat" verify --print-certs "release\$name.apk" | Select-String 'SHA-256'
& "$env:JAVA_HOME\bin\jarsigner.exe" -verify "release\$name.aab" | Select-Object -Last 1
Get-ChildItem release | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } }
