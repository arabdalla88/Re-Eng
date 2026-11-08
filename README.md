# Re-Eng

الموقع بقى JavaScript ثابت: Vercel بيعرض الموقع، وSupabase بيحفظ الطلبات والصور ويدير دخول الأدمن. مفيش Flask ولا سيرفر خاص محتاج تشغّله.

## تشغيل الموقع أونلاين

### ١. تجهيز Supabase مرة واحدة

1. افتح مشروعك في Supabase → **SQL Editor** → **New query**.
2. انسخ محتوى `supabase_setup.sql` بالكامل من المستودع والصقه في الاستعلام، وبعدها اضغط **Run**.
3. من **Authentication → Users**، أضف مستخدم الأدمن بالإيميل والباسورد اللي هتستخدمهم لدخول لوحة الأدمن.
4. ارجع إلى **SQL Editor**، وغيّر `admin@example.com` في آخر استعلام في `supabase_setup.sql` لإيميل الأدمن. شيل `--` من أول الأسطر الثلاثة وشغّل الاستعلام.
5. من **Project Settings → API**، انسخ **Project URL** و**anon / publishable key**. دول مفاتيح عامة مخصصة للموقع. **ما تستخدمش `service_role` key.**

### ٢. ربط الموقع بـSupabase

افتح `public/static/config.js` واستبدل `YOUR_SUPABASE_PROJECT_URL` و`YOUR_SUPABASE_ANON_KEY` بالقيم اللي نسختها. ما تغيّرش `storageBucket`.

احفظ الملف وارفع التغيير إلى GitHub. لو مستودع GitHub مربوط بـVercel، هينشر الموقع تلقائيًا. لو مش مربوط: اعمل **Add New → Project** في Vercel واستورد `arabdalla88/Re-Eng`؛ إعدادات النشر موجودة في `vercel.json`.

بعد أول نشر، في Supabase افتح **Authentication → URL Configuration** وحط رابط موقع Vercel في **Site URL**.

بعدها افتح الموقع: الزوار يقدروا يقدموا أدوات، والأدمن يدخل بإيميل وباسورد الخطوة ٣. بيانات الاتصال تظهر للأدمن فقط.

> مفتاح `anon / publishable` ظاهر في كود المتصفح عمدًا؛ أمان البيانات معتمد على سياسات Supabase الموجودة في `supabase_setup.sql`. ما تحطش أبدًا مفتاح `service_role` في الموقع.

## معاينة محلية والاختبارات

افتح `public/index.html` باستخدام إضافة VS Code مثل Live Server، بعد إعداد `config.js`.

```powershell
node --test tests\smoke.test.js
node --check public\static\app.js
```

ملفات SQLite والصور المحلية القديمة لا تنتقل تلقائيًا إلى Supabase.
