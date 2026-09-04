import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import pg from 'pg';
import ChartDataLabels from 'chartjs-plugin-datalabels';


import { registerFont } from 'canvas';
import pkg from 'chartjs-node-canvas';
const { ChartJSNodeCanvas } = pkg;

// register the DejaVuSans font for use in charts
registerFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', {
  family: 'DejaVuSans'
});


dotenv.config();

const token = process.env.BOT_TOKEN;
const admins = process.env.ADMINS.split(",").map(x => x.trim());
const isValidUser = (userId) => admins.includes(userId.toString());
const patientID = process.env.PATIENT_ID;

const bot = new TelegramBot(token, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.on('polling_error', (err) => {
  console.error('polling error:', err.code, err.message);
});
const userState = {};

// Chart.js setup
const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width: 800,
  height: 400,
  plugins: {
    modern: ['chartjs-plugin-datalabels']
  },
  chartCallback: (ChartJS) => {
    ChartJS.defaults.font.family = 'DejaVuSans';
    ChartJS.register(ChartDataLabels);
  }
});

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// --- START ---
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Що хочеш зробити?", {
    reply_markup: {
      keyboard: [
        [{ text: "Ввести тиск" }],
        [{ text: "Останні вимірювання" }],
        [{ text: "Графік тиску" }]
      ],
      resize_keyboard: true
    }
  });
});

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!isValidUser(userId)) return;

  // ==== LAST MEASUREMENTS =====
  if (text === "Останні вимірювання") {
    try {
      const result = await pool.query(
        `SELECT systolic, diastolic, created_at
         FROM pressure_data
         WHERE user_id = $1
         ORDER BY id DESC
         LIMIT 5`,
        [patientID]
      );

      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, "Немає жодних збережених вимірювань 😔");
      }

      let message = "🩺 *Останні 5 вимірювань:*\n\n";

      result.rows.forEach((row, index) => {
        message += `${index + 1}. *${row.systolic}/${row.diastolic}* — ${formatDate(row.created_at)}\n`;
      });

      return bot.sendMessage(chatId, message, { parse_mode: "Markdown" });

    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, "Помилка отримання даних ❌");
    }
  }

  // ==== BUTTON: ENTER PRESSURE =====
  if (text === "Ввести тиск") {
    userState[userId] = { step: "waiting_systolic" };
    return bot.sendMessage(chatId, "Введи *систолічний* тиск (верхній):", { parse_mode: "Markdown" });
  }

  // ==== SYSTOLIC =====
  if (userState[userId]?.step === "waiting_systolic") {
    const systolic = parseInt(text, 10);

    if (isNaN(systolic)) {
      return bot.sendMessage(chatId, "❌ Введи лише число. Спробуй ще раз.");
    }

    userState[userId].systolic = systolic;
    userState[userId].step = "waiting_diastolic";

    return bot.sendMessage(chatId, "Тепер введи *діастолічний* тиск (нижній):", { parse_mode: "Markdown" });
  }

  // ==== DIASTOLIC =====
  if (userState[userId]?.step === "waiting_diastolic") {
    const diastolic = parseInt(text, 10);

    if (isNaN(diastolic)) {
      return bot.sendMessage(chatId, "❌ Введи лише число. Спробуй ще раз.");
    }

    const systolic = userState[userId].systolic;

    try {
      await pool.query(
        `INSERT INTO pressure_data (user_id, systolic, diastolic)
         VALUES ($1, $2, $3)`,
        [patientID, systolic, diastolic]
      );

      bot.sendMessage(chatId, `Дані збережено ✅\n\n${systolic}/${diastolic}`);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "Помилка запису в БД ❌");
    }

    delete userState[userId];
    return;
  }

  if (text === "Графік тиску") {
    try {
      const result = await pool.query(
        `SELECT systolic, diastolic, created_at
          FROM pressure_data
          WHERE user_id = $1
          ORDER BY id DESC
          LIMIT 30`,
        [patientID]
      );

      if (result.rows.length === 0) {
        return bot.sendMessage(chatId, "Немає даних для графіка 😔");
      }

      const buffer = await createPressureChart(result.rows);

      return bot.sendPhoto(chatId, buffer, {
        caption: "📈 Графік ваших останніх вимірювань"
      });

    } catch (err) {
      console.error(err);
      return bot.sendMessage(chatId, "Помилка генерації графіка ❌");
    }
  }
});

function formatDate(date) {
  const d = new Date(date);

  // add 2 hours to convert from UTC to local time (assuming local time is UTC+2)
  const local = new Date(d.getTime() + 2 * 60 * 60 * 1000);

  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');

  const hours = String(local.getHours()).padStart(2, '0');
  const minutes = String(local.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

async function createPressureChart(rows) {
  const labels = rows.map(r => {
    const d = new Date(r.created_at);
    return d.toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  });
  const systolic = rows.map(r => r.systolic);
  const diastolic = rows.map(r => r.diastolic);

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Systolic',
          borderColor: 'red',
          data: systolic,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: 'red'
        },
        {
          label: 'Diastolic',
          borderColor: 'blue',
          data: diastolic,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: 'blue'
        }
      ]
    },
    options: {
      responsive: false,
      plugins: {
        legend: { position: 'bottom' },

        datalabels: {
          color: '#000',
          anchor: 'end',
          align: 'top',
          font: {
            size: 12,
            family: 'DejaVuSans'
          },
          formatter: (value) => value
        }
      }
    }
  };


  return await chartJSNodeCanvas.renderToBuffer(config);
}