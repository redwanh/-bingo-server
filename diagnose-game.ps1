# ============================================
# BINGO GAME - COMPLETE DIAGNOSTIC SCRIPT
# ============================================

param(
    [string]$baseUrl = "http://167.233.204.54",
    [string]$adminPhone = "+251900000000",
    [string]$adminPassword = "Admin@1234"
)

Clear-Host

# ============================================
# LOGIN AS ADMIN
# ============================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BINGO GAME DIAGNOSTIC TOOL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$adminBody = @{ phone = $adminPhone; password = $adminPassword } | ConvertTo-Json

try {
    $adminLogin = Invoke-RestMethod `
        -Uri "$baseUrl/api/auth/login" `
        -Method Post `
        -Body $adminBody `
        -ContentType "application/json"
    
    $adminToken = $adminLogin.accessToken
    Write-Host "Admin: $($adminLogin.user.fullName)" -ForegroundColor Green
} catch {
    Write-Host "FAILED to login!" -ForegroundColor Red
    exit
}

# ============================================
# FUNCTION: Make Authenticated API Call
# ============================================
function Get-Api {
    param([string]$Url)
    try {
        return Invoke-RestMethod -Uri "$baseUrl$Url" -Method Get `
            -Headers @{ Authorization = "Bearer $adminToken" } -ErrorAction Stop
    } catch { return $null }
}

function Format-Date {
    param($DateString)
    if (-not $DateString) { return "N/A" }
    try {
        $date = [DateTime]::Parse($DateString)
        return $date.ToString("yyyy-MM-dd HH:mm")
    } catch {
        # If it's already formatted or can't parse, return as-is
        if ($DateString -is [string] -and $DateString.Length -gt 16) {
            return $DateString.Substring(0, 16)
        }
        return $DateString
    }
}

# ============================================
# 1. GAME CONFIGURATION
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  1. GAME CONFIGURATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$config = Get-Api "/api/game/config/fast_bingo"

if ($config) {
    Write-Host "  Room ID         : $($config.roomId)" -ForegroundColor White
    Write-Host "  Room Name       : $($config.roomName)" -ForegroundColor White
    Write-Host "  Card Price      : $($config.cardPrice) ETB" -ForegroundColor White
    Write-Host "  Max Cards/Player: $($config.maxCardsPerPlayer)" -ForegroundColor White
    Write-Host "  Min Players     : $($config.minPlayersToStart)" -ForegroundColor White
    Write-Host "  Min Cards       : $($config.minCardsToStart)" -ForegroundColor White
    Write-Host "  Wait Time       : $($config.waitTimeSeconds)s" -ForegroundColor White
    Write-Host "  Draw Interval   : $($config.drawIntervalSeconds)s" -ForegroundColor White
    Write-Host "  Commission      : $($config.commissionPercentage)%" -ForegroundColor White
    Write-Host "  Grace Period    : $($config.gracePeriodSeconds)s" -ForegroundColor White
    Write-Host "  Reset on Empty  : $($config.resetOnNoPlayers)" -ForegroundColor White
    Write-Host "  Voice Enabled   : $($config.voiceEnabled)" -ForegroundColor White
    Write-Host "  Auto Mark       : $($config.autoMarkDefault)" -ForegroundColor White
    Write-Host "  Active          : $($config.isActive)" -ForegroundColor White
}

# ============================================
# 2. CURRENT ACTIVE GAME
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  2. CURRENT ACTIVE GAME" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$gameState = Get-Api "/api/game/state/fast_bingo"

if ($gameState) {
    $statusColor = switch ($gameState.status) {
        "in_progress" { "Green" }
        "bingo_called" { "Magenta" }
        "waiting" { "Yellow" }
        default { "White" }
    }
    
    Write-Host "  Game ID         : $($gameState.gameId)" -ForegroundColor White
    Write-Host "  Game Number     : $($gameState.gameNumber)" -ForegroundColor White
    Write-Host "  Status          : $($gameState.status.ToUpper())" -ForegroundColor $statusColor
    Write-Host "  Players         : $($gameState.playerCount)" -ForegroundColor White
    Write-Host "  Total Cards     : $($gameState.totalCards)" -ForegroundColor White
    Write-Host "  Prize Pool      : $($gameState.prizePool) ETB" -ForegroundColor Yellow
    Write-Host "  Draw Count      : $($gameState.drawCount)" -ForegroundColor White
    Write-Host "  Time Remaining  : $([math]::Round($gameState.timeRemaining, 0))s" -ForegroundColor $(if ($gameState.timeRemaining -lt 10) { "Red" } else { "White" })
    Write-Host "  Timer Duration  : $($gameState.timerDuration)s" -ForegroundColor White
    
    if ($gameState.timerStartedAt) {
        Write-Host "  Timer Started   : $(Format-Date $gameState.timerStartedAt)" -ForegroundColor White
    }
    
    # Current number
    if ($gameState.currentNumber -and $gameState.currentNumber.number -gt 0) {
        Write-Host ""
        Write-Host "  >>> CURRENT: $($gameState.currentNumber.letter)-$($gameState.currentNumber.number) <<<" -ForegroundColor Yellow
    }
    
    # Drawn numbers
    if ($gameState.drawnNumbers -and $gameState.drawnNumbers.Count -gt 0) {
        Write-Host ""
        Write-Host "  DRAWN ($($gameState.drawCount)):" -ForegroundColor Yellow
        
        $chunks = @()
        $currentChunk = @()
        for ($i = 0; $i -lt $gameState.drawnNumbers.Count; $i++) {
            $dn = $gameState.drawnNumbers[$i]
            $currentChunk += "$($dn.letter)-$($dn.number)"
            if ($currentChunk.Count -ge 10) {
                $chunks += ($currentChunk -join " ")
                $currentChunk = @()
            }
        }
        if ($currentChunk.Count -gt 0) {
            $chunks += ($currentChunk -join " ")
        }
        
        foreach ($chunk in $chunks) {
            Write-Host "  $chunk" -ForegroundColor Gray
        }
    }
}

# ============================================
# 3. ALL PLAYERS & THEIR CARDS
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  3. PLAYERS & CARDS (with phone numbers)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$playerPhones = @(
    "+251910000003", "+251910000004", "+251910000005",
    "+251910000006", "+251910000007", "+251910000008",
    "+251910000009", "+251910000010", "+251910000011",
    "+251910000012"
)

$playersWithCards = @()
$playersWithoutCards = @()

foreach ($phone in $playerPhones) {
    $playerBody = @{ phone = $phone; password = "Test@1234" } | ConvertTo-Json
    
    try {
        $playerLogin = Invoke-RestMethod `
            -Uri "$baseUrl/api/auth/login" `
            -Method Post `
            -Body $playerBody `
            -ContentType "application/json"
        
        $playerToken = $playerLogin.accessToken
        
        $playerState = Invoke-RestMethod `
            -Uri "$baseUrl/api/game/state/fast_bingo" `
            -Method Get `
            -Headers @{ Authorization = "Bearer $playerToken" } `
            -ErrorAction Stop
        
        if ($playerState.myCardsCount -gt 0) {
            $cardNums = ($playerState.myCards | ForEach-Object { "#$($_.cardNumber)" }) -join ", "
            
            $playersWithCards += [PSCustomObject]@{
                Phone    = $phone
                Name     = $playerLogin.user.fullName
                Balance  = "$($playerLogin.user.walletBalance) ETB"
                Cards    = $playerState.myCardsCount
                CardList = $cardNums
            }
        } else {
            $playersWithoutCards += [PSCustomObject]@{
                Phone   = $phone
                Name    = $playerLogin.user.fullName
                Balance = "$($playerLogin.user.walletBalance) ETB"
            }
        }
    } catch {
        # Skip players that don't exist
    }
}

if ($playersWithCards.Count -gt 0) {
    Write-Host "WITH CARDS:" -ForegroundColor Green
    $playersWithCards | Format-Table Phone, Name, Cards, Balance, CardList -AutoSize -Wrap
}

if ($playersWithoutCards.Count -gt 0) {
    Write-Host "WITHOUT CARDS:" -ForegroundColor Yellow
    $playersWithoutCards | Format-Table Phone, Name, Balance -AutoSize
}

# ============================================
# 4. RECENT COMPLETED GAMES
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  4. RECENT COMPLETED GAMES" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$history = Get-Api "/api/game/history/fast_bingo"

if ($history -and $history.Count -gt 0) {
    $historyTable = $history | Select-Object -First 10 | ForEach-Object {
        $winnersCount = if ($_.winners) { $_.winners.Count } else { 0 }
        [PSCustomObject]@{
            'Game#'  = $_.gameNumber
            'Pool'   = "$($_.prizePool) ETB"
            'Cards'  = $_.totalCards
            'Winners' = $winnersCount
            'Ended'  = Format-Date $_.endTime
        }
    }
    
    $historyTable | Format-Table -AutoSize
} else {
    Write-Host "No completed games yet." -ForegroundColor Gray
}

# ============================================
# 5. RECENT TRANSACTIONS (Admin sees all)
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  5. YOUR TRANSACTIONS (Admin)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$transactions = Get-Api "/api/game/transactions"

if ($transactions -and $transactions.Count -gt 0) {
    $txnTable = $transactions | Select-Object -First 10 | ForEach-Object {
        [PSCustomObject]@{
            'Type'   = $_.type
            'Amount' = "$($_.amount) ETB"
            'Game#'  = $_.gameNumber
            'Desc'   = if ($_.description.Length -gt 40) { $_.description.Substring(0, 37) + "..." } else { $_.description }
            'Date'   = Format-Date $_.createdAt
        }
    }
    
    $txnTable | Format-Table -AutoSize
} else {
    Write-Host "No transactions found." -ForegroundColor Gray
}

# ============================================
# 6. ACTIONS & SUMMARY
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SUMMARY & ACTIONS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$status = $gameState.status
$players = $gameState.playerCount
$needed = $config.minPlayersToStart - $players

Write-Host "  Status : $status" -ForegroundColor $(if ($status -eq "in_progress") { "Green" } else { "Yellow" })
Write-Host "  Players: $players (need $($config.minPlayersToStart) min)" -ForegroundColor $(if ($needed -le 0) { "Green" } else { "Red" })

if ($needed -gt 0) {
    Write-Host "  >>> Need $needed more player(s) to buy cards! <<<" -ForegroundColor Red
}

if ($status -eq "waiting" -and $gameState.timeRemaining -le 0) {
    Write-Host "  Timer expired - polling for more players..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Quick API Commands:" -ForegroundColor White
Write-Host "  ----------------------------------------" -ForegroundColor Gray
Write-Host "  Preview Card : POST /api/game/preview/fast_bingo" -ForegroundColor Gray
Write-Host "  Register Card: POST /api/game/register/fast_bingo" -ForegroundColor Gray
Write-Host "  Buy Direct   : POST /api/game/buy/fast_bingo" -ForegroundColor Gray
Write-Host "  Call Bingo   : POST /api/game/bingo/fast_bingo" -ForegroundColor Gray
Write-Host "  Force End    : POST /api/game/admin/force-end/fast_bingo" -ForegroundColor Gray

# ============================================
# 7. GAME STATUS EXPLANATION
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  STATUS GUIDE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  scheduled   = Waiting for first player" -ForegroundColor Gray
Write-Host "  waiting     = Timer running, accepting players" -ForegroundColor Yellow
Write-Host "  in_progress = Numbers being drawn" -ForegroundColor Green
Write-Host "  bingo_called = Someone won, grace period active" -ForegroundColor Magenta
Write-Host "  completed   = Game over, prizes paid" -ForegroundColor Cyan
Write-Host ""

Write-Host "Diagnostic complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")