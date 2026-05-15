$pem = (Get-Content "C:\users\micha\downloads\rpgclub.private-key.pem" -Raw).Replace("`r`n", "\n").Replace("`n", "\n").Trim()
$envPath = "C:\code\RPGClubBotTs\.env"
$envContent = Get-Content $envPath -Raw
$updated = $envContent -replace 'GITHUB_APP_PRIVATE_KEY=.*', "GITHUB_APP_PRIVATE_KEY=`"$pem`""
Set-Content $envPath $updated -Encoding utf8 -NoNewline