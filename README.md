# DORI TOP — Full-Stack Platforma

O‘zbekiston bo‘ylab dorilarni qidirish, narxlarni taqqoslash va dorixonalar omborini boshqarish tizimi.

## Texnologiyalar
- **Backend:** Node.js (22.13+ yoki 24), Express, ichki SQLite (`node:sqlite`, C++ Build Tools kerak emas), JWT, `bcryptjs`, `helmet`
- **Frontend:** HTML + Tailwind CSS + Lucide + Leaflet
- **PostgreSQL / Supabase:** `src/supabase_schema.sql` (SQLite sxemasi bilan to‘liq mos)

## Ishga tushirish
```bash
cp .env.example .env      # so'ng .env ni to'ldiring (JWT_SECRET va ADMIN_PHONE!)
npm install
npm start                 # http://localhost:3000
npm test                  # yordamchi funksiyalar va SQL testlari
```

## Muhim sozlamalar (.env)
| O‘zgaruvchi | Izoh |
|---|---|
| `JWT_SECRET` | Productionda majburiy, kamida 32 belgi. Zaif/namunaviy kalit bilan server ishga tushmaydi. |
| `ADMIN_PHONE` | Shu telefon raqami egasi **Administrator** bo‘ladi. Productionda albatta kiriting. |
| `NODE_ENV=production` | Birinchi foydalanuvchini avtomatik admin qilishni o‘chiradi. |
| `APP_TIMEZONE` | "Ochiq/Yopiq" hisoblanadigan vaqt zonasi (standart `Asia/Tashkent`). |
| `TRUST_PROXY` | Nginx/Cloudflare ortida bo‘lsa `1`. |
| `BACKUP_DIR` | Berilsa, baza avtomatik zaxiralanadi (`BACKUP_EVERY_HOURS`, `BACKUP_KEEP`). |
| `CSP_ENABLED=false` | Sahifa xavfsizlik siyosati sababli to‘g‘ri ochilmasa, vaqtincha o‘chirish uchun. |

## Rollar
- **Mehmon** (login qilmagan): qidiruv, narxlar, xarita, yo‘nalish — hammasi ochiq.
- **Foydalanuvchi:** dorixona ochish uchun ariza yuboradi (bir vaqtda bitta ariza, litsenziya raqami takrorlanmasligi kerak).
- **Dorixona egasi:** admin arizani tasdiqlasa avtomatik shu rolni oladi. Telefon, manzil, ish vaqti, ombor va CSV import.
- **Administrator:** arizalar, foydalanuvchilar/rollar, dorixonalar (egasini o‘zgartirish), dorilar (tahrirlash, o‘chirish, dublikatni birlashtirish).

Rol o‘zgartirishda: egani oddiy foydalanuvchiga tushirsangiz, uning dorixonalari uchun qaror so‘raladi (qoldirish / o‘chirish / boshqa egaga o‘tkazish). Oxirgi adminni tushirib bo‘lmaydi.

## CSV formati
`name,active_ingredient,manufacturer,dosage,category,price,status[,prescription]`
(`;` ajratgich ham qo‘llanadi; bir martada ko‘pi bilan 2000 qator.)

## Boshlang‘ich holat
Baza (`data/dori_top.db`) bo‘sh yaratiladi, demo ma’lumot yo‘q. `ADMIN_PHONE` raqami bilan ro‘yxatdan o‘ting → admin panel ochiladi.

## Eslatma
`index.html` Tailwind'ni CDN orqali (play CDN) yuklaydi — bu ishlab chiqish uchun qulay, lekin production uchun Tailwind CLI bilan build qilish tavsiya etiladi.
