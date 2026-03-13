const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Multer setup for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Helper function to shuffle an array (Fisher-Yates shuffle)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

app.post('/api/generate', upload.single('excelFile'), async (req, res) => {
  try {
    const { paperType } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    const questionKey = Object.keys(jsonData[0] || {}).find(key => key.trim() === 'Question');
    const typeKey = Object.keys(jsonData[0] || {}).find(key => key.trim() === 'Type');

    if (!questionKey || !typeKey) {
      return res.status(400).json({ error: 'Excel file missing "Question" or "Type" column' });
    }

    // Process questions
    const questionBank = jsonData.map(row => {
      let questionText = (row[questionKey] || '').toString().trim();
      questionText = questionText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');

      let type = null;
      const t = (row[typeKey] || '').toString().trim().toLowerCase();
      if (t === 'm') type = 'multiple-choice';
      else if (t === 'f' || t === 'o') type = 'fill-in-the-blank';
      else return null;

      let question = questionText;
      let optionA = null, optionB = null, optionC = null, optionD = null;

      if (type === 'multiple-choice') {
        const optionRegex = /([A-Da-d])[\.\)]\s*(.*?)(?=\s*[A-Da-d][\.\)]\s*|$)/g;
        let match;
        let options = [];
        while ((match = optionRegex.exec(questionText)) !== null) {
          options.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
        }
        if (options.length >= 4) {
          const firstMatch = questionText.match(/([A-Da-d])[\.\)]\s*/);
          if (firstMatch) {
            question = questionText.substring(0, firstMatch.index).trim();
            optionA = options.find(o => o.letter === 'A')?.text || null;
            optionB = options.find(o => o.letter === 'B')?.text || null;
            optionC = options.find(o => o.letter === 'C')?.text || null;
            optionD = options.find(o => o.letter === 'D')?.text || null;
          }
        } else {
          return null;
        }
      }

      const unit = parseInt(row['Unit']) || 0;
      if (unit < 1) return null;

      return {
        subjectCode: row['Subject Code'] || '',
        subject: row['Subject'] || '',
        branch: row['Branch'] || '',
        regulation: row['Regulation'] || '',
        year: row['Year'] || '',
        semester: row['Sem'] || '',
        month: row['Month'] || '',
        unit,
        question,
        imageUrl: row['Image Url'] || null,
        type,
        ...(type === 'multiple-choice' ? { optionA, optionB, optionC, optionD } : {})
      };
    }).filter(q => q && q.question && q.subjectCode);

    if (questionBank.length === 0) {
      return res.status(400).json({ error: 'No valid questions found in Excel' });
    }

    // Group by unit & type
    const multipleChoiceByUnit = {
      1: questionBank.filter(q => q.unit === 1 && q.type === 'multiple-choice'),
      2: questionBank.filter(q => q.unit === 2 && q.type === 'multiple-choice'),
      3: questionBank.filter(q => q.unit === 3 && q.type === 'multiple-choice'),
      4: questionBank.filter(q => q.unit === 4 && q.type === 'multiple-choice'),
      5: questionBank.filter(q => q.unit === 5 && q.type === 'multiple-choice'),
    };

    const fillInTheBlankByUnit = {
      1: questionBank.filter(q => q.unit === 1 && q.type === 'fill-in-the-blank'),
      2: questionBank.filter(q => q.unit === 2 && q.type === 'fill-in-the-blank'),
      3: questionBank.filter(q => q.unit === 3 && q.type === 'fill-in-the-blank'),
      4: questionBank.filter(q => q.unit === 4 && q.type === 'fill-in-the-blank'),
      5: questionBank.filter(q => q.unit === 5 && q.type === 'fill-in-the-blank'),
    };

    console.log('Available MCQs:', {
      u1: multipleChoiceByUnit[1].length,
      u2: multipleChoiceByUnit[2].length,
      u3: multipleChoiceByUnit[3].length,
      u4: multipleChoiceByUnit[4].length,
      u5: multipleChoiceByUnit[5].length
    });

    console.log('Available FIBs:', {
      u1: fillInTheBlankByUnit[1].length,
      u2: fillInTheBlankByUnit[2].length,
      u3: fillInTheBlankByUnit[3].length,
      u4: fillInTheBlankByUnit[4].length,
      u5: fillInTheBlankByUnit[5].length
    });

    let selectedQuestions = [];

    if (paperType === 'mid1') {
      // Mid 1 pattern: prefer unit 1 → 2 → fallback to unit 3
      const mc1 = shuffleArray([...multipleChoiceByUnit[1]]).slice(0, 4);
      const mc2 = shuffleArray([...multipleChoiceByUnit[2]]).slice(0, 4);
      const mc3 = shuffleArray([...multipleChoiceByUnit[3]]).slice(0, 2);

      const fib1 = shuffleArray([...fillInTheBlankByUnit[1]]).slice(0, 4);
      const fib2 = shuffleArray([...fillInTheBlankByUnit[2]]).slice(0, 4);
      const fib3 = shuffleArray([...fillInTheBlankByUnit[3]]).slice(0, 2);

      selectedQuestions = [...mc1, ...mc2, ...mc3, ...fib1, ...fib2, ...fib3];

      // If total < 16 → take extra from unit 3 to reach closer to 20
      if (selectedQuestions.length < 16) {
        const remaining = 20 - selectedQuestions.length;
        const extraMC = shuffleArray([...multipleChoiceByUnit[3].filter(q => !mc3.includes(q))]).slice(0, remaining);
        const extraFIB = shuffleArray([...fillInTheBlankByUnit[3].filter(q => !fib3.includes(q))]).slice(0, remaining);
        selectedQuestions.push(...extraMC, ...extraFIB);
      }

      if (selectedQuestions.length < 14) {
        return res.status(400).json({
          error: `Not enough questions for Mid-1 (got ${selectedQuestions.length}, target ~20)`
        });
      }
    } 
    else if (paperType === 'mid2') {
      // Mid 2 pattern: unit 3 (small part) → unit 4 → unit 5
      const mc3 = shuffleArray([...multipleChoiceByUnit[3]]).slice(0, 2);
      const mc4 = shuffleArray([...multipleChoiceByUnit[4]]).slice(0, 4);
      const mc5 = shuffleArray([...multipleChoiceByUnit[5]]).slice(0, 4);

      const fib3 = shuffleArray([...fillInTheBlankByUnit[3]]).slice(0, 2);
      const fib4 = shuffleArray([...fillInTheBlankByUnit[4]]).slice(0, 4);
      const fib5 = shuffleArray([...fillInTheBlankByUnit[5]]).slice(0, 4);

      selectedQuestions = [...mc3, ...mc4, ...mc5, ...fib3, ...fib4, ...fib5];

      // If short → take extra from unit 5 or 4
      if (selectedQuestions.length < 16) {
        const remaining = 20 - selectedQuestions.length;
        const extraMC = shuffleArray([...multipleChoiceByUnit[5].filter(q => !mc5.includes(q))]).slice(0, remaining);
        const extraFIB = shuffleArray([...fillInTheBlankByUnit[5].filter(q => !fib5.includes(q))]).slice(0, remaining);
        selectedQuestions.push(...extraMC, ...extraFIB);
      }

      if (selectedQuestions.length < 14) {
        return res.status(400).json({
          error: `Not enough questions for Mid-2 (got ${selectedQuestions.length}, target ~20)`
        });
      }
    } 
    else {
      return res.status(400).json({ error: 'Invalid paperType. Use "mid1" or "mid2".' });
    }

    // Paper metadata from first question
    const paperDetails = selectedQuestions.length > 0 ? {
      subjectCode: selectedQuestions[0].subjectCode,
      subject: selectedQuestions[0].subject,
      branch: selectedQuestions[0].branch,
      regulation: selectedQuestions[0].regulation,
      year: selectedQuestions[0].year,
      semester: selectedQuestions[0].semester,
      month: selectedQuestions[0].month
    } : {};

    const response = {
      paperDetails,
      questions: selectedQuestions.map(q => ({
        question: q.question,
        unit: q.unit,
        imageUrl: q.imageUrl,
        type: q.type,
        ...(q.type === 'multiple-choice' ? {
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD
        } : {})
      }))
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error generating paper:', error);
    res.status(500).json({ error: 'Server error generating paper: ' + error.message });
  }
});

app.get('/api/image-proxy-base64', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No image URL provided' });
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch image');
    const buffer = await response.buffer();
    const base64 = buffer.toString('base64');
    const mimeType = response.headers.get('content-type') || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    res.json({ dataUrl });
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).json({ error: 'Failed to fetch image: ' + error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
