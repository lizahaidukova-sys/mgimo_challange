import 'dotenv/config';
import { seed } from '../db/seed';

seed();
console.log('База заполнена демонстрационными данными.');
console.log('Пароль для всех аккаунтов: demo12345');
console.log('  student1@demo.local — Анна Королёва, есть долги');
console.log('  student2@demo.local — Дмитрий Соколов, всё закрыто');
console.log('  staff@demo.local    — Ирина Белова, деканат');
