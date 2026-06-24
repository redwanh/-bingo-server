# Step 1: Login as Player 3
$body = @{phone="+251910000003";password="Test@1234"} | ConvertTo-Json
$login = Invoke-RestMethod -Uri "http://167.233.204.54/api/auth/login" -Method Post -Body $body -ContentType "application/json"
$token = $login.accessToken
Write-Host "Player 3 logged in. Balance: $($login.user.walletBalance) ETB" -ForegroundColor Green

# Step 2: Check current game state
$state = Invoke-RestMethod -Uri "http://167.233.204.54/api/game/state/fast_bingo" -Headers @{Authorization="Bearer $token"}
Write-Host "Game #$($state.gameNumber) - Status: $($state.status) - Players: $($state.playerCount)" -ForegroundColor Yellow
Write-Host "Config: Min Players=$($state.config.minPlayersToStart), Wait=$($state.config.waitTimeSeconds)s" -ForegroundColor Gray

# Step 3: Buy a card
Write-Host "`nBuying card..." -ForegroundColor Yellow
$buy = Invoke-RestMethod -Uri "http://167.233.204.54/api/game/buy/fast_bingo" -Method Post -Headers @{Authorization="Bearer $token"}
if($buy.success) {
    Write-Host "Card #$($buy.card.cardNumber) purchased! New balance: $($buy.newBalance) ETB" -ForegroundColor Green
}

# Step 4: Watch the game start
Write-Host "`nWatching game status (checking every 2 seconds)..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

for($i=1; $i -le 10; $i++) {
    Start-Sleep -Seconds 2
    $state = Invoke-RestMethod -Uri "http://167.233.204.54/api/game/state/fast_bingo" -Headers @{Authorization="Bearer $token"}
    
    $timeLeft = [math]::Round($state.timeRemaining, 0)
    $statusColor = if($state.status -eq 'in_progress'){'Green'}else{'Yellow'}
    
    Write-Host "Check $i : Status=$($state.status) | Players=$($state.playerCount) | Time=$timeLeft`s | Draws=$($state.drawCount)" -ForegroundColor $statusColor
    
    if($state.status -eq 'in_progress') {
        Write-Host "`n*** GAME STARTED! ***" -ForegroundColor Green
        Write-Host "Current number: $($state.currentNumber.letter)-$($state.currentNumber.number)" -ForegroundColor Yellow
        
        # Watch numbers draw
        for($j=1; $j -le 3; $j++) {
            Start-Sleep -Seconds 6
            $state = Invoke-RestMethod -Uri "http://167.233.204.54/api/game/state/fast_bingo" -Headers @{Authorization="Bearer $token"}
            Write-Host "  Draw #$($state.drawCount): $($state.currentNumber.letter)-$($state.currentNumber.number)" -ForegroundColor Cyan
        }
        break
    }
    
    if($i -eq 10) {
        Write-Host "`nGame did not start within 20 seconds. Check server console for [TIMER] logs." -ForegroundColor Red
    }
}