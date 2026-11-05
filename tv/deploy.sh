#!/usr/bin/env bash
# Devor ekrani ilovasini LG televizoriga o'rnatadi.
#
#   tv/deploy.sh                  — 192.168.100.86 ga o'rnatadi
#   TV_IP=192.168.100.50 tv/deploy.sh
#
# Qachon kerak: televizor proshivkasi yangilanganda yoki Developer Mode
# sessiyasi tugaganda LG yon tomondan o'rnatilgan ilovalarni o'chirib
# yuboradi. Shunda Developer Mode'ga qayta kirib, shu skriptni ishga
# tushirish kifoya.
#
# ares-install o'rniga to'g'ridan-to'g'ri ssh ishlatiladi: televizordagi
# OpenSSH 6.1 faqat `ssh-rsa` ni qo'llaydi va zamonaviy ssh uni sukut
# bo'yicha rad etadi. Pastdagi parametrlar aynan shu muammoni yechadi.
set -euo pipefail

TV_IP="${TV_IP:-192.168.100.86}"
KALIT="${TV_KEY:-$HOME/.ssh/webos_nasaftv_plain}"
ILOVA_ID="uz.nasafdigital.wallscreen"
BU_YER="$(cd "$(dirname "$0")" && pwd)"
CHIQISH="$BU_YER/dist"

SSH=(ssh -i "$KALIT" -p 9922
  -o BatchMode=yes -o ConnectTimeout=10 -o IdentitiesOnly=yes
  -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa
  -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o LogLevel=ERROR
  "prisoner@$TV_IP")

echo "▶ 1/4  Yig'ilmoqda…"
rm -rf "$CHIQISH" && mkdir -p "$CHIQISH/src"
cp -R "$BU_YER/app/." "$CHIQISH/src/"
# Har bir yig'ishning o'z belgisi bor. O'rnatish tugaganini televizordagi
# shu fayl orqali bilamiz — luna-send javobiga ishonib bo'lmaydi: u
# javobni buferda ushlaydi va `timeout` uni to'xtatganda oxirgi qism,
# aynan "installed" xabari, yo'qolib ketishi mumkin.
BELGI="$(date +%Y%m%d%H%M%S)-$$"
echo "$BELGI" > "$CHIQISH/src/build.txt"
npx --yes -p @webos-tools/cli ares-package "$CHIQISH/src" -o "$CHIQISH" >/dev/null 2>&1
IPK="$(ls "$CHIQISH"/*.ipk)"
echo "       $(basename "$IPK")"

echo "▶ 2/4  Televizorga yuborilmoqda ($TV_IP)…"
MAQSAD="/media/developer/temp/$(basename "$IPK")"
"${SSH[@]}" "cat > '$MAQSAD'" < "$IPK"

echo "▶ 3/4  O'rnatilmoqda…"
# O'rnatish fonda boshlanadi, biz esa belgi paydo bo'lishini kutamiz.
# Ilova o'chirilmasdan ustidan yoziladi — shu sabab devor ekranining
# kirish holati (localStorage) saqlanib qoladi, qayta kirish shart emas.
"${SSH[@]}" "nohup timeout 120 /usr/bin/luna-send-pub -i -f \
  luna://com.webos.appInstallService/dev/install \
  '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$MAQSAD\",\"subscribe\":true}' \
  >/dev/null 2>&1 &"
O_RNATILGAN="/media/developer/apps/usr/palm/applications/$ILOVA_ID/build.txt"
for _ in $(seq 1 60); do
  sleep 2
  if [ "$("${SSH[@]}" "cat '$O_RNATILGAN' 2>/dev/null" || true)" = "$BELGI" ]; then
    TAYYOR=1; break
  fi
done
"${SSH[@]}" "rm -f '$MAQSAD'" || true
if [ -z "${TAYYOR:-}" ]; then
  echo "❌ 2 daqiqada o'rnatilmadi. Developer Mode yoqilganini tekshiring."; exit 1
fi

echo "▶ 4/4  Ishga tushirilmoqda…"
"${SSH[@]}" "/usr/bin/luna-send-pub -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$ILOVA_ID\"}'" >/dev/null

echo "✅ Tayyor — televizorda «Nasaf Devor ekrani» ochildi."
