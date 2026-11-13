// Приймає заявку з сайту і передає її в CRM за API-ключем.
// Ключі зберігаються у змінних середовища Netlify, а не в коді сторінки.
//   CRM_TYPE      keycrm | salesdrive | custom
//   CRM_API_KEY   API-ключ CRM
//   CRM_SOURCE_ID (для KeyCRM) числовий id джерела замовлення
//   CRM_URL       (для salesdrive / custom) адреса, куди надсилати заявку
// Необов'язково, дубль повідомлення в Telegram: BOT_TOKEN, CHAT_ID
const clean = (v, n = 200) => String(v || '').replace(/<[^>]*>/g, '').trim().slice(0, n);
const json = (ok, code = 200) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok }) });

async function sendCrm(l) {
  const type = (process.env.CRM_TYPE || '').toLowerCase();
  const key = process.env.CRM_API_KEY;
  if (!type || !key) return null; // CRM не налаштована
  const comment = [l.design && 'Деталі: ' + l.design, 'Джерело: ' + l.source, l.utm && 'UTM: ' + l.utm].filter(Boolean).join('\n');
  let url, headers = { 'Content-Type': 'application/json', Accept: 'application/json' }, body;
  if (type === 'keycrm') {
    url = 'https://openapi.keycrm.app/v1/order';
    headers.Authorization = 'Bearer ' + key;
    body = { source_id: Number(process.env.CRM_SOURCE_ID) || undefined, buyer: { full_name: l.name, phone: l.phone },
      manager_comment: comment, products: [{ name: l.product, price: l.price, quantity: 1 }] };
  } else if (type === 'salesdrive') {
    url = process.env.CRM_URL;
    body = { form: key, fName: l.name, phone: l.phone, comment,
      products: [{ id: 'bedding', name: l.product, costPerItem: l.price, amount: 1 }] };
  } else { // custom
    url = process.env.CRM_URL;
    headers.Authorization = 'Bearer ' + key; headers['X-Api-Key'] = key;
    body = { name: l.name, phone: l.phone, product: l.product, price: l.price, design: l.design, source: l.source, utm: l.utm, comment };
  }
  if (!url) { console.error('CRM_URL is not set'); return false; }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) console.error('CRM ERROR', r.status, (await r.text()).slice(0, 500));
    return r.ok;
  } catch (e) { console.error('CRM FETCH ERROR', e.message); return false; }
}

async function sendTelegram(l) {
  if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) return null;
  const text = `🆕 Нова заявка\nТовар: ${l.product}\nЦіна: ${l.price} грн\nІм'я: ${l.name}\nТелефон: ${l.phone}` +
    (l.design ? `\nДеталі: ${l.design}` : '') + `\nДжерело: ${l.source}` + (l.utm ? `\nUTM: ${l.utm}` : '');
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.CHAT_ID, text }) });
    const res = await r.json();
    if (!res.ok) console.error('TELEGRAM ERROR', JSON.stringify(res));
    return !!res.ok;
  } catch (e) { console.error('TELEGRAM FETCH ERROR', e.message); return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(false, 405);
  let d = {};
  try { d = JSON.parse(event.body || '{}'); } catch (e) { return json(false, 400); }
  if (d.website) return json(false); // антиспам-поле
  const l = { name: clean(d.name), phone: clean(d.phone, 30), design: clean(d.design), source: clean(d.source),
    utm: clean(d.utm, 300), product: clean(d.product) || 'Товар', price: Number(d.price) || 0 };
  if (l.name.length < 2 || l.phone.replace(/\D/g, '').length < 10) return json(false, 400);
  const [crm, tg] = await Promise.all([sendCrm(l), sendTelegram(l)]);
  if (crm === null && tg === null) { console.error('NOTHING CONFIGURED: set CRM_TYPE + CRM_API_KEY'); return json(false, 500); }
  return json(crm === true || tg === true);
};
