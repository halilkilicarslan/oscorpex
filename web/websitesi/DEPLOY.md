# Deploy · Oscorpex websitesi

Firebase Hosting · hesap `oscorpex@gmail.com` · proje `oscorpex-37fa4` · https://oscorpex-37fa4.web.app (özel alan adı bağlı)

Yalnızca açıkça istendiğinde deploy et. Derleme yok; bu klasör (`oscorpex/web/websitesi`) olduğu gibi yayınlanır.

```bash
cd ~/development/personal/oscorpex/web/websitesi
env -u FIREBASE_TOKEN firebase deploy --only hosting --project oscorpex-37fa4 --account oscorpex@gmail.com
```

İletişim formu backend'i ayrı bir Cloudflare Worker'dır: `../contact-worker` (endpoint `https://api.oscorpex.com/contact`, Resend ile mail). Worker deploy'u: `cd ~/development/personal/oscorpex/web/contact-worker && npx wrangler deploy`.

- `env -u FIREBASE_TOKEN`: kabuktaki `FIREBASE_TOKEN` rightyon hesabına ait ve `--account` seçeneğini ezer; bu yüzden kaldırılmalı.
- Ayarlar: `firebase.json` (site `oscorpex-37fa4`, `public: "."`) ve `.firebaserc`.
- Kontrol: `/` 200 dönmeli, başlık "Oscorpex — Autonomous Software Engineering" olmalı; `styles.css`, `main.js`, `logo-icon.svg` 200 dönmeli.
- Bu hosting'e başka site deploy edilmez: ne `oscorpex-website` (Next.js) ne Sayiyo (`design-system/websitesi`).
