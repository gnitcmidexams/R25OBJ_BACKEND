const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Multer setup → memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Fisher-Yates shuffle
function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

app.post('/api/generate', upload.single('excelFile'), async (req, res) => {
  try {
    const { paperType } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded' });
    }

    if (!['mid1', 'mid2'].includes(paperType)) {
      return res.status(400).json({ error: 'paperType must be "mid1" or "mid2"' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // Find column indices
    const headers = jsonData[0].map(h => (h || '').trim().toLowerCase());
    const col = {
      subjectCode: headers.indexOf('subject code'),
      subject: headers.indexOf('subject'),
      branch: headers.indexOf('branch'),
      regulation: headers.indexOf('regulation'),
      year: headers.indexOf('year'),
      sem: headers.indexOf('sem'),
      month: headers.indexOf('month'),
      unit: headers.indexOf('unit'),
      question: headers.indexOf('question'),
      type: headers.indexOf('type'),
      // imageUrl: headers.indexOf('image url') || -1,
    };

    if (col.question === -1 || col.type === -1 || col.unit === -1) {
      return res.status(400).json({
        error: 'Excel must contain columns: Question, Type, Unit (case insensitive)'
      });
    }

    const questionBank = [];

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      const qText = (row[col.question] || '').toString().trim().replace(/\s+/g, ' ');
      const typeRaw = (row[col.type] || '').toString().trim().toLowerCase();
      const unitRaw = row[col.unit];

      if (!qText) continue;

      let type = null;
      if (typeRaw === 'm') type = 'mcq';
      else if (typeRaw === 'f' || typeRaw === 'fib') type = 'fib';
      else continue; // skip unknown types

      let unit = Number(unitRaw);
      if (isNaN(unit) || unit < 1 || unit > 5) continue;

      let question = qText;
      let options = null;

      if (type === 'mcq') {
        // Try to split question + options
        const parts = qText.split(/\s*[A-Da-d][\.\)]\s*/);
        if (parts.length >= 5) {
          question = parts[0].trim();
          options = parts.slice(1, 5).map(t => t.trim());
        } else {
          // fallback — keep whole text as question, no options split
        }
      }

      questionBank.push({
        subjectCode: row[col.subjectCode] || '',
        subject: row[col.subject] || '',
        branch: row[col.branch] || '',
        regulation: row[col.regulation] || '',
        year: row[col.year] || '',
        semester: row[col.sem] || '',
        month: row[col.month] || '',
        unit,
        question,
        type,
        options, // array of 4 strings or null
        // imageUrl: col.imageUrl >= 0 ? (row[col.imageUrl] || null) : null,
      });
    }

    if (questionBank.length === 0) {
      return res.status(400).json({ error: 'No valid questions found in Excel' });
    }

    // Group by unit & type
    const mcqByUnit = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const fibByUnit = { 1: [], 2: [], 3: [], 4: [], 5: [] };

    questionBank.forEach(q => {
      if (q.type === 'mcq') {
        if (mcqByUnit[q.unit]) mcqByUnit[q.unit].push(q);
      } else if (q.type === 'fib') {
        if (fibByUnit[q.unit]) fibByUnit[q.unit].push(q);
      }
    });

    // Debug counts
    console.log('MCQ counts per unit:', Object.fromEntries(
      Object.entries(mcqByUnit).map(([u, arr]) => [u, arr.length])
    ));
    console.log('FIB counts per unit:', Object.fromEntries(
      Object.entries(fibByUnit).map(([u, arr]) => [u, arr.length])
    ));

    let selected = [];

    if (paperType === 'mid1') {
      // Mid 1 ───────────────────────────────
      const need = {
        mcq: [4, 4, 2],
        fib: [4, 4, 2]
      };

      for (let u = 1; u <= 3; u++) {
        const mcqs = shuffleArray(mcqByUnit[u]).slice(0, need.mcq[u - 1]);
        const fibs = shuffleArray(fibByUnit[u]).slice(0, need.fib[u - 1]);

        if (mcqs.length < need.mcq[u - 1] || fibs.length < need.fib[u - 1]) {
          return res.status(400).json({
            error: `Not enough questions in Unit ${u} for Mid-1\n` +
                   `MCQ needed: ${need.mcq[u - 1]}, have: ${mcqByUnit[u].length}\n` +
                   `FIB needed: ${need.fib[u - 1]}, have: ${fibByUnit[u].length}`
          });
        }

        selected.push(...mcqs, ...fibs);
      }
    } else {
      // Mid 2 ───────────────────────────────
      const need = {
        mcq: [2, 4, 4], // unit 3,4,5
        fib: [2, 4, 4]
      };

      // We take from the "second half" of unit 3 — very rough approximation
      const unit3McqSecondHalf = shuffleArray(mcqByUnit[3]).slice(-10); // last 10
      const unit3FibSecondHalf = shuffleArray(fibByUnit[3]).slice(-10);

      const mcqU3 = shuffleArray(unit3McqSecondHalf).slice(0, need.mcq[0]);
      const fibU3 = shuffleArray(unit3FibSecondHalf).slice(0, need.fib[0]);

      const mcqU4 = shuffleArray(mcqByUnit[4]).slice(0, need.mcq[1]);
      const mcqU5 = shuffleArray(mcqByUnit[5]).slice(0, need.mcq[2]);

      const fibU4 = shuffleArray(fibByUnit[4]).slice(0, need.fib[1]);
      const fibU5 = shuffleArray(fibByUnit[5]).slice(0, need.fib[2]);

      if (
        mcqU3.length < need.mcq[0] ||
        mcqU4.length < need.mcq[1] ||
        mcqU5.length < need.mcq[2] ||
        fibU3.length < need.fib[0] ||
        fibU4.length < need.fib[1] ||
        fibU5.length < need.fib[2]
      ) {
        return res.status(400).json({
          error: `Not enough questions for Mid-2\n` +
                 `Unit 3 MCQ: ${mcqU3.length}/${need.mcq[0]}\n` +
                 `Unit 4 MCQ: ${mcqU4.length}/${need.mcq[1]}\n` +
                 `Unit 5 MCQ: ${mcqU5.length}/${need.mcq[2]}\n` +
                 `Unit 3 FIB: ${fibU3.length}/${need.fib[0]}\n` +
                 `Unit 4 FIB: ${fibU4.length}/${need.fib[1]}\n` +
                 `Unit 5 FIB: ${fibU5.length}/${need.fib[2]}`
        });
      }

      selected.push(...mcqU3, ...mcqU4, ...mcqU5, ...fibU3, ...fibU4, ...fibU5);
    }

    // Prepare clean response
    const paperInfo = selected[0]
      ? {
          subjectCode: selected[0].subjectCode,
          subject: selected[0].subject,
          branch: selected[0].branch,
          regulation: selected[0].regulation,
          year: selected[0].year,
          semester: selected[0].semester,
          month: selected[0].month
        }
      : {};

    const questions = selected.map(q => ({
      question: q.question,
      unit: q.unit,
      type: q.type,
      options: q.options || null,
      // imageUrl: q.imageUrl || null,
    }));

    res.json({
      paperType,
      paperDetails: paperInfo,
      totalQuestions: questions.length,
      questions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error while generating paper',
      detail: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`Question paper generator running on http://localhost:${port}`);
});
