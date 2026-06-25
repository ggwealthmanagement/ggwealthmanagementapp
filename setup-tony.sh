#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-tony.sh  —  Creates Tony's full client profile in the G&G app
# Run from Terminal:  bash setup-tony.sh
# ─────────────────────────────────────────────────────────────────────────────

BASE="https://ggwealthmanagementapp-production.up.railway.app"
COOKIE="/tmp/gg_coach_session.txt"
rm -f "$COOKIE"

ok()  { echo "  ✅ $1"; }
err() { echo "  ❌ $1"; }
hdr() { echo; echo "── $1 ──────────────────────────────────"; }

# ── 1. Coach login ────────────────────────────────────────────────────────────
hdr "1. Coach login"
read -p "  Enter your coach username: " COACH_USER
read -s -p "  Enter your coach password: " COACH_PASS
echo
LOGIN=$(curl -s -c "$COOKIE" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${COACH_USER}\",\"password\":\"${COACH_PASS}\"}")
echo "  $LOGIN"
if echo "$LOGIN" | grep -q '"role":"coach"'; then ok "Logged in as coach"
else err "Login failed — check username/password and try again"; exit 1; fi

# ── 2. Create Tony's account ──────────────────────────────────────────────────
hdr "2. Create Tony (client account)"
CREATE=$(curl -s -b "$COOKIE" -c "$COOKIE" -X POST "$BASE/api/coach/clients" \
  -H "Content-Type: application/json" \
  -d '{
    "username":         "tony",
    "password":         "tony123",
    "name":             "Tony",
    "income_amount":    5000,
    "income_frequency": "monthly"
  }')
echo "  $CREATE"
TONY_ID=$(echo "$CREATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
if [ -z "$TONY_ID" ]; then
  # Maybe Tony already exists — look him up
  CLIENTS=$(curl -s -b "$COOKIE" "$BASE/api/coach/clients")
  TONY_ID=$(echo "$CLIENTS" | python3 -c "import sys,json; cl=json.load(sys.stdin); t=[c for c in cl if c['name']=='Tony']; print(t[0]['id'] if t else '')" 2>/dev/null)
fi
if [ -z "$TONY_ID" ]; then err "Could not get Tony's ID — stopping"; exit 1; fi
ok "Tony created (ID=$TONY_ID)"

# ── 3. Login as Tony to set up his data ───────────────────────────────────────
hdr "3. Switch to Tony's session"
TCOOKIE="/tmp/gg_tony_session.txt"
rm -f "$TCOOKIE"
TLOGIN=$(curl -s -c "$TCOOKIE" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"tony","password":"tony123"}')
echo "  $TLOGIN"
if echo "$TLOGIN" | grep -q '"role":"client"'; then ok "Logged in as Tony"
else err "Tony login failed"; exit 1; fi

# ── 4. Budget (income already set via create; verify it) ──────────────────────
hdr "4. Check Tony's budget"
BUDGET=$(curl -s -b "$TCOOKIE" "$BASE/api/budget")
echo "  $BUDGET"
# Update budget with income + percentages
# $5000/mo: fixed=$3000(60%), savings=$500(10%), debt=$500(10%), wants=$1000(20%)
BPUT=$(curl -s -b "$TCOOKIE" -X PUT "$BASE/api/budget" \
  -H "Content-Type: application/json" \
  -d '{
    "weekly_income": 1153.85,
    "income_amount": 5000,
    "income_frequency": "monthly",
    "fixed_pct":   60,
    "wants_pct":   20,
    "savings_pct": 10,
    "debt_pct":    10
  }')
echo "  $BPUT"
ok "Budget set: \$5,000/mo | Fixed 60% | Wants 20% | Savings 10% | Debt 10%"

# ── 5. Fixed expenses ($3,000 total — 5 common bills) ─────────────────────────
hdr "5. Fixed expenses (\$3,000/mo total)"
add_fixed() {
  curl -s -b "$TCOOKIE" -X POST "$BASE/api/fixed" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$1\",\"amount\":$2,\"due_day\":\"$3\"}" > /dev/null
  ok "Added fixed: $1 = \$$2 (due $3)"
}
add_fixed "Rent"          1500 "1st"
add_fixed "Car Insurance"  200 "15th"
add_fixed "Utilities"      300 "10th"
add_fixed "Internet"       100 "5th"
add_fixed "Groceries"      900 "1st"

# ── 6. Emergency Fund ($5,000 goal) ───────────────────────────────────────────
hdr "6. Emergency Fund (\$5,000 goal)"
EF=$(curl -s -b "$TCOOKIE" -X POST "$BASE/api/savings" \
  -H "Content-Type: application/json" \
  -d '{
    "name":           "Emergency Fund",
    "goal_amount":    5000,
    "current_amount": 0,
    "weekly_contrib": 125,
    "is_emergency":   1
  }')
echo "  $EF"
ok "Emergency Fund created: \$0 / \$5,000 goal | \$125/week"

# ── 7. Savings goal ($500/mo) ─────────────────────────────────────────────────
hdr "7. Savings goal"
SG=$(curl -s -b "$TCOOKIE" -X POST "$BASE/api/savings" \
  -H "Content-Type: application/json" \
  -d '{
    "name":           "Monthly Savings",
    "goal_amount":    6000,
    "current_amount": 0,
    "weekly_contrib": 125
  }')
echo "  $SG"
ok "Savings goal: \$500/mo (\$125/week) toward \$6,000"

# ── 8. Car debt ($30,000 @ $500/mo) ───────────────────────────────────────────
hdr "8. Car debt"
DEBT=$(curl -s -b "$TCOOKIE" -X POST "$BASE/api/debts" \
  -H "Content-Type: application/json" \
  -d '{
    "name":        "Car Loan",
    "type":        "Car",
    "balance":     30000,
    "paid":        0,
    "min_payment": 500
  }')
echo "  $DEBT"
ok "Car Loan: \$30,000 | \$500/mo min payment"

# ── 9. Verify everything ──────────────────────────────────────────────────────
hdr "9. Verification"
echo "  Budget:  $(curl -s -b "$TCOOKIE" "$BASE/api/budget" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'income_amount=\${d.get(\"income_amount\",\"?\")}, fixed={d.get(\"fixed_pct\")}%, wants={d.get(\"wants_pct\")}%, savings={d.get(\"savings_pct\")}%, debt={d.get(\"debt_pct\")}%')" 2>/dev/null)"
echo "  Fixed:   $(curl -s -b "$TCOOKIE" "$BASE/api/fixed" | python3 -c "import sys,json; items=json.load(sys.stdin); print(f'{len(items)} items, total=\${sum(i[\"amount\"] for i in items)}')" 2>/dev/null)"
echo "  Savings: $(curl -s -b "$TCOOKIE" "$BASE/api/savings" | python3 -c "import sys,json; items=json.load(sys.stdin); print(f'{len(items)} goals')" 2>/dev/null)"
echo "  Debts:   $(curl -s -b "$TCOOKIE" "$BASE/api/debts" | python3 -c "import sys,json; items=json.load(sys.stdin); print(f'{len(items)} debts, total=\${sum(i[\"balance\"] for i in items)}')" 2>/dev/null)"

echo
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Tony's profile is ready!"
echo "     Login:  tony / tony123"
echo "     URL:    $BASE/gg-login.html"
echo "═══════════════════════════════════════════════════════"
