# Зеркала · Пятигорск

Сайт с закрытой панелью владельца, работами, отзывами и галереями фотографий.

Сборка: `npm install` и `npm run build`. Каталог результата: `dist`.
Vercel автоматически использует `vercel.json`.

В `.env.production` находятся только публичные URL и publishable key Supabase.
Доступ к изменению данных защищён Supabase Auth и RLS. Секретные ключи не нужны.
Панель владельца: `/?owner=1`.

Для восстановления пароля добавьте адрес опубликованного сайта с
`/?owner=recovery` в Supabase Authentication → URL Configuration → Redirect URLs.
Не заменяйте существующий Site URL другого приложения.
