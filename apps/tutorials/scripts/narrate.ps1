param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$tutorialVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $tutorialVoice.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
if (-not $voice) { throw 'Instale uma voz pt-BR do Windows para gerar a narração.' }
$tutorialVoice.SelectVoice($voice.VoiceInfo.Name)
$tutorialVoice.Rate = 3
$texts = Get-Content -LiteralPath (Join-Path $Directory 'texts.json') -Encoding UTF8 -Raw | ConvertFrom-Json
try {
  for ($i = 0; $i -lt $texts.Count; $i++) {
    $tutorialVoice.SetOutputToWaveFile((Join-Path $Directory "$i.wav"))
    $tutorialVoice.Speak($texts[$i])
    $tutorialVoice.SetOutputToNull()
  }
} finally { $tutorialVoice.Dispose() }
