import { photoEditor } from './photo-editor.js';
const LEGACY_KEY = 'zerkalo-owner-content-v1';
export function initOwnerPanel({ client, store, seed, dialog, body, openDialog, notify, esc, formatPrice, onContent }) {
  let tab = 'works';
  let data = { works: [], reviews: [] };
  let busy = false;
  let authorizationGeneration = 0;
  const errorBox = '<p class="ownerError" role="alert" aria-live="polite"></p>';
  const show = (title, html, wide = false) => {
    openDialog(title, html, wide);
    dialog.dataset.ownerView = 'true';
  };
  const active = () => dialog.open && dialog.dataset.ownerView === 'true';
  const bind = (id, event, handler) => body.querySelector('#' + id)?.addEventListener(event, handler);
  const fail = error => {
    const message = error?.message || 'Не удалось выполнить действие. Попробуйте ещё раз.';
    const box = body.querySelector('[role=alert]');
    if (box) box.textContent = message;
    else notify(message);
  };
  async function operation(action) {
    if (busy) return;
    busy = true;
    const controls = [...body.querySelectorAll('button,input,textarea')];
    controls.forEach(control => { control.disabled = true; });
    const alert = body.querySelector('[role=alert]');
    if (alert) alert.textContent = '';
    try { await action(); } catch (error) { fail(error); }
    finally { busy = false; controls.forEach(control => { control.disabled = false; }); }
  }
  async function refresh() {
    const [works, reviews] = await Promise.all([store.listWorks(), store.listReviews()]);
    data = { works, reviews };
    onContent(data);
  }
  function bindLogout() {
    bind('ownerLogout', 'click', () => operation(async () => {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      loginView();
    }));
  }
  const logoutButton = '<button class="ownerTool" id="ownerLogout" type="button">Выйти</button>';

  function loginView() {
    show('Вход владельца',
      '<p class="ownerNote">Войдите, чтобы управлять работами и отзывами.</p>' +
      '<form id="ownerLoginForm" class="ownerForm">' +
      '<div class="field"><label for="ownerEmail">Email</label><input id="ownerEmail" type="email" autocomplete="username" required></div>' +
      '<div class="field"><label for="ownerPassword">Пароль</label><input id="ownerPassword" type="password" autocomplete="current-password" required></div>' +
      errorBox + '<button type="submit" class="btn">Войти</button></form>' +
      '<button class="ownerBack" id="ownerForgot" type="button">Забыли пароль?</button>');
    bind('ownerLoginForm', 'submit', event => {
      event.preventDefault();
      const email = body.querySelector('#ownerEmail').value.trim();
      const password = body.querySelector('#ownerPassword').value;
      operation(async () => {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error('Не удалось войти. Проверьте email и пароль.');
        await open();
      });
    });
    bind('ownerForgot', 'click', resetEmailView);
  }
  function deniedView() {
    show('Панель владельца', '<p>У этого аккаунта нет доступа к редактированию сайта.</p>' + errorBox + logoutButton);
    bindLogout();
  }
  function resetEmailView() {
    show('Восстановление доступа', '<p class="ownerNote">Укажите email владельца. Ссылка для изменения пароля придёт на почту.</p>' +
      '<form id="ownerResetForm" class="ownerForm"><div class="field"><label for="ownerResetEmail">Email</label>' +
      '<input id="ownerResetEmail" type="email" autocomplete="email" required></div>' + errorBox +
      '<button class="btn" type="submit">Отправить ссылку</button></form><button class="ownerBack" id="ownerBackLogin" type="button">← Ко входу</button>');
    bind('ownerBackLogin', 'click', loginView);
    bind('ownerResetForm', 'submit', event => {
      event.preventDefault();
      const email = body.querySelector('#ownerResetEmail').value.trim();
      operation(async () => {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?owner=recovery' });
        if (error) throw new Error('Не удалось отправить ссылку. Попробуйте позже или обратитесь к владельцу аккаунта Supabase.');
        show('Проверьте почту', '<p>Если аккаунт с этим email существует, на него придёт ссылка для изменения пароля.</p><button class="btn" id="ownerBackLogin" type="button">Ко входу</button>');
        bind('ownerBackLogin', 'click', loginView);
      });
    });
  }
  async function recoveryView() {
    if (!await store.isOwner()) { deniedView(); return; }
    show('Новый пароль', '<form id="ownerRecoveryForm" class="ownerForm">' +
      '<div class="field"><label for="ownerNewPassword">Новый пароль</label><input id="ownerNewPassword" type="password" minlength="8" autocomplete="new-password" required></div>' +
      '<div class="field"><label for="ownerConfirmPassword">Повторите пароль</label><input id="ownerConfirmPassword" type="password" minlength="8" autocomplete="new-password" required></div>' +
      '<p class="ownerNote">Минимум 8 символов. Этот аккаунт также используется в другом сайте в вашем проекте Supabase — пароль изменится для обоих сайтов.</p>' +
      errorBox + '<button class="btn" type="submit">Сохранить пароль</button></form>');
    bind('ownerRecoveryForm', 'submit', event => {
      event.preventDefault();
      const password = body.querySelector('#ownerNewPassword').value;
      if (password !== body.querySelector('#ownerConfirmPassword').value) { fail(new Error('Пароли не совпадают.')); return; }
      operation(async () => {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new Error('Не удалось изменить пароль. Запросите новую ссылку и попробуйте ещё раз.');
        history.replaceState(null, '', location.pathname);
        notify('Пароль изменён');
        await open();
      });
    });
  }
  function rows() {
    if (!data[tab].length) return '<p class="ownerEmpty">Пока здесь ничего нет. Добавьте первую запись.</p>';
    return '<div class="ownerList">' + data[tab].map(item =>
      '<div class="ownerRow">' + (tab === 'works' ? '<img src="' + esc(item.image) + '" alt="">' : '<div class="ownerAvatar">★★★★★</div>') +
      '<div><strong>' + esc(tab === 'works' ? item.title : item.author) + '</strong><p>' +
      esc(tab === 'works' ? item.description + ' · ' + formatPrice(item.price) : item.text) + '</p></div>' +
      '<div class="ownerRowActions"><button class="ownerTab" type="button" data-owner-edit="' + esc(item.id) + '">Изменить</button>' +
      '<button class="ownerDelete" type="button" data-owner-delete="' + esc(item.id) + '">Удалить</button></div></div>'
    ).join('') + '</div>';
  }
  function legacyData() {
    try { return JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { return null; }
  }
  function panelView() {
    show('Панель владельца', '<div class="ownerTop"><div class="ownerTabs">' +
      ['works', 'reviews'].map(key => '<button type="button" class="ownerTab ' + (tab === key ? 'active' : '') +
        '" data-owner-tab="' + key + '">' + (key === 'works' ? 'Мои работы' : 'Отзывы') + ' · ' + data[key].length + '</button>').join('') +
      '</div>' + logoutButton + '</div><div class="ownerExportTools">' +
      '<button class="ownerTool" id="ownerAdd" type="button">＋ Добавить</button><button class="ownerTool" id="ownerExport" type="button">Скачать копию</button>' +
      '<label class="ownerTool" for="ownerImportFile">Загрузить копию</label><input id="ownerImportFile" class="ownerImportInput" type="file" accept=".json,application/json">' +
      (legacyData() ? '<button class="ownerTool" id="ownerImportLocal" type="button">Перенести данные этого браузера</button>' : '') +
      (!data.works.length && !data.reviews.length ? '<button class="ownerTool" id="ownerImportSeed" type="button">Добавить исходные 9 работ</button>' : '') +
      '</div><p class="ownerNote">Сохранённые изменения видны посетителям сайта на всех устройствах.</p>' + errorBox + rows(), true);
    bindLogout();
    body.querySelectorAll('[data-owner-tab]').forEach(button => button.addEventListener('click', () => { if (!busy) { tab = button.dataset.ownerTab; panelView(); } }));
    bind('ownerAdd', 'click', () => formView());
    body.querySelectorAll('[data-owner-edit]').forEach(button => button.addEventListener('click', () => formView(data[tab].find(item => item.id === button.dataset.ownerEdit))));
    body.querySelectorAll('[data-owner-delete]').forEach(button => button.addEventListener('click', () => {
      if (!confirm('Удалить ' + (tab === 'works' ? 'работу' : 'отзыв') + '?')) return;
      operation(async () => {
        const result = await (tab === 'works' ? store.deleteWork(button.dataset.ownerDelete) : store.deleteReview(button.dataset.ownerDelete));
        await refresh(); panelView();
        notify(result?.cleanupWarning ? 'Запись удалена. Старое фото осталось в хранилище.' : 'Запись удалена');
      });
    }));
    bind('ownerImportFile', 'change', event => {
      const file = event.target.files[0];
      if (!file) return;
      operation(async () => {
        if (file.size > 100 * 1024 * 1024) throw new Error('Файл копии слишком большой: максимум 100 МБ.');
        let payload;
        try { payload = JSON.parse(await file.text()); } catch { throw new Error('Не удалось прочитать JSON-копию.'); }
        await importData(payload);
      });
    });
    bind('ownerImportLocal', 'click', () => operation(() => importData(legacyData())));
    bind('ownerImportSeed', 'click', () => operation(() => importData(seed)));
    bind('ownerExport', 'click', () => operation(async () => {
      const payload = await store.exportContent();
      if (payload.works.length + payload.reviews.length > 200 || new Blob([JSON.stringify(payload, null, 2)]).size > 100 * 1024 * 1024) throw new Error('Копия превышает лимит восстановления (200 записей или 100 МБ). Для большого архива используйте экспорт из Supabase; данные на сайте сохранены.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'zerkalo-owner-data.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Копия с фотографиями скачана');
    }));
  }
  async function importData(payload) {
    if (!payload || !Array.isArray(payload.works) || !Array.isArray(payload.reviews)) throw new Error('В копии должны быть работы и отзывы.');
    if (!confirm('Добавить ' + payload.works.length + ' работ и ' + payload.reviews.length + ' отзывов? Текущие записи сохранятся. Повторный импорт добавит копии.')) return;
    await store.importLegacyContent(payload, 'append');
    await refresh(); panelView(); notify('Записи добавлены');
  }
  function formView(item = {}) {
    const work = tab === 'works';
    const input = (id, label, value, attributes = '') => '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" value="' + esc(value ?? '') + '" ' + attributes + '></div>';
    const textarea = (id, label, value, max) => '<div class="field"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" required maxlength="' + max + '">' + esc(value || '') + '</textarea></div>';
    const fields = work
      ? input('ownerTitle', 'Название', item.title, 'required maxlength="90"') +
        textarea('ownerDescription', 'Описание', item.description, 500) + '<div class="dialogGrid">' +
        input('ownerSize', 'Размер (необязательно)', item.size, 'maxlength="30" placeholder="180 × 70"') +
        input('ownerPrice', 'Цена, ₽', item.price, 'type="number" min="0" max="2147483647" step="1" required') + '</div>'
      : input('ownerAuthor', 'Имя или подпись автора', item.author, 'maxlength="80"') +
        textarea('ownerText', 'Текст отзыва (или добавьте фото)', item.text, 1200).replace(' required ', ' ') + input('ownerDate', 'Дата или подпись (необязательно)', item.date, 'maxlength="50"');
    show((item.id ? 'Редактировать' : 'Добавить') + (work ? ' работу' : ' отзыв'),
      '<button class="ownerBack" id="ownerBack" type="button">← К панели</button><form id="ownerItemForm" class="ownerForm">' +
      fields + '<div id="photoEditor"></div>' + errorBox + '<div class="ownerFormActions"><button class="btn" type="submit">Сохранить</button><button class="btn secondary" id="ownerCancel" type="button">Отмена</button></div></form>', true);
    const editor=photoEditor(body.querySelector('#photoEditor'),item,esc,fail);
    dialog.addEventListener('close',()=>editor.dispose(),{once:true});
    const cancel=()=>{editor.dispose();panelView()};
    bind('ownerBack', 'click', cancel); bind('ownerCancel', 'click', cancel);
    bind('ownerItemForm', 'submit', event => {
      event.preventDefault();
      const value = id => body.querySelector('#' + id).value;
      const record = work ? { ...item, title: value('ownerTitle'), description: value('ownerDescription'), size: value('ownerSize'), price: Number(value('ownerPrice')) }
        : { ...item, author: value('ownerAuthor'), text: value('ownerText'), date: value('ownerDate'), removeImage: !!body.querySelector('#removeReviewImage')?.checked };
      const drafts=editor.get();
      operation(async () => {
        const photos=[]; for(const draft of drafts) photos.push(draft.file?{file:await preparePhoto(draft.file)}:{path:draft.path});
        const result=work?await store.saveWork(record,photos):await store.saveReview(record,photos);
        editor.dispose();
        await refresh(); panelView();
        notify(result?.cleanupWarning ? 'Сохранено. Старое фото осталось в хранилище.' : 'Сохранено');
      });
    });
  }
  async function open() {
    const generation = ++authorizationGeneration;
    if (!client || !store) {
      show('Панель владельца', '<p>Подключение к базе ещё не настроено. Редактирование станет доступно после настройки сайта.</p>');
      return;
    }
    show('Панель владельца', '<p>Проверяем вход…</p>' + errorBox);
    try {
      const { data: sessionData, error } = await client.auth.getSession();
      if (error) throw error;
      if (generation !== authorizationGeneration) return;
      if (!sessionData.session) { loginView(); return; }
      const owner = await store.isOwner();
      if (generation !== authorizationGeneration) return;
      if (!owner) { deniedView(); return; }
      await refresh();
      if (generation === authorizationGeneration) panelView();
    } catch {
      show('Панель владельца', '<p>Не удалось загрузить данные. Проверьте подключение и попробуйте снова.</p>' + errorBox +
        '<button class="btn" id="ownerRetry" type="button">Повторить</button>' + logoutButton);
      bind('ownerRetry', 'click', open); bindLogout();
    }
  }
  if (client) {
    client.auth.onAuthStateChange(event => {
      // Defer Supabase calls until the Auth callback releases its internal lock.
      if (event === 'PASSWORD_RECOVERY') setTimeout(() => recoveryView().catch(fail), 0);
      if (event === 'SIGNED_OUT') {
        authorizationGeneration++;
        if (active()) loginView();
      }
    });
  }
  if (new URLSearchParams(location.search).get('owner') === '1') setTimeout(open, 0);
  return { open };
}

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('Выберите фото JPG, PNG или WebP до 20 МБ.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Не удалось открыть фото. Выберите другой файл.'); }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
  if (!blob) throw new Error('Не удалось подготовить фото.');
  return blob;
}

