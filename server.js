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
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    const questionKey = Object.keys(jsonData[0]).find(key => key.trim() === 'Question');
    const typeKey = Object.keys(jsonData[0]).find(key => key.trim() === 'Type');

    if (!questionKey) {
      return res.status(400).json({ error: 'No "Question" column found in the Excel file' });
    }
    if (!typeKey) {
      return res.status(400).json({ error: 'No "Type" column found in the Excel file' });
    }

    // Process questions
    const questionBank = jsonData.map(row => {
      let questionText = row[questionKey] ? row[questionKey].toString().trim() : '';
      questionText = questionText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');

      let type;
      if (row[typeKey] && row[typeKey].toLowerCase() === 'm') {
        type = 'multiple-choice';
      } else if (row[typeKey] && (row[typeKey].toLowerCase() === 'f' || row[typeKey].toLowerCase() === 'o')) {
        type = 'fill-in-the-blank';
      } else {
        console.log(`Skipping row due to invalid type: ${row[typeKey]}`);
        return null;
      }

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
          console.log(`Insufficient options for MCQ: ${questionText}`);
          return null;
        }
      }

      const unit = parseInt(row['Unit']) || 0;

      return {
        subjectCode: row['Subject Code'] || '',
        subject: row['Subject'] || '',
        branch: row['Branch'] || '',
        regulation: row['Regulation'] || '',
        year: row['Year'] || 0,
        semester: row['Sem'] || 0,
        month: row['Month'] || '',
        unit: unit,
        question: question,
        imageUrl: row['Image Url'] || null,
        type: type,
        ...(type === 'multiple-choice' ? { optionA, optionB, optionC, optionD } : {})
      };
    }).filter(q => q && q.subjectCode && q.question && q.unit > 0);

    if (questionBank.length === 0) {
      return res.status(400).json({ error: 'No valid questions found in the Excel file' });
    }

    // Organize by unit and type
    const multipleChoiceByUnit = {
      1: questionBank.filter(q => q.unit === 1 && q.type === 'multiple-choice'),
      2: questionBank.filter(q => q.unit === 2 && q.type === 'multiple-choice'),
      3: questionBank.filter(q => q.unit === 3 && q.type === 'multiple-choice'),
      4: questionBank.filter(q => q.unit === 4 && q.type === 'multiple-choice'),
      5: questionBank.filter(q => q.unit === 5 && q.type === 'multiple-choice')
    };

    const fillInTheBlankByUnit = {
      1: questionBank.filter(q => q.unit === 1 && q.type === 'fill-in-the-blank'),
      2: questionBank.filter(q => q.unit === 2 && q.type === 'fill-in-the-blank'),
      3: questionBank.filter(q => q.unit === 3 && q.type === 'fill-in-the-blank'),
      4: questionBank.filter(q => q.unit === 4 && q.type === 'fill-in-the-blank'),
      5: questionBank.filter(q => q.unit === 5 && q.type === 'fill-in-the-blank')
    };

    console.log('Available questions per unit:', {
      unit1: { mc: multipleChoiceByUnit[1].length, fib: fillInTheBlankByUnit[1].length },
      unit2: { mc: multipleChoiceByUnit[2].length, fib: fillInTheBlankByUnit[2].length },
      unit3: { mc: multipleChoiceByUnit[3].length, fib: fillInTheBlankByUnit[3].length },
      unit4: { mc: multipleChoiceByUnit[4].length, fib: fillInTheBlankByUnit[4].length },
      unit5: { mc: multipleChoiceByUnit[5].length, fib: fillInTheBlankByUnit[5].length }
    });

    let selectedQuestions = [];

    if (paperType === 'mid1') {
      // Mid 1: prefer unit 1 → 2 → fall back to unit 3
      let mc = [];
      let fib = [];

      [1, 2, 3].forEach(u => {
        const mcPool = multipleChoiceByUnit[u] || [];
        const fibPool = fillInTheBlankByUnit[u] || [];

        const wantMC  = (u === 3) ? 8 : 5;
        const wantFIB = (u === 3) ? 8 : 5;

        mc.push(...shuffleArray([...mcPool]).slice(0, wantMC));
        fib.push(...shuffleArray([...fibPool]).slice(0, wantFIB));
      });

      selectedQuestions = [...mc, ...fib];

      if (selectedQuestions.length < 12) {
        return res.status(400).json({
          error: `Not enough questions for Mid-1 (got only ${selectedQuestions.length}). Need more in units 1,2,3.`
        });
      }

      console.log(`Mid-1 generated: ${mc.length} MCQs + ${fib.length} FIBs`);
    } 
    else if (paperType === 'mid2') {
      // Mid 2: few from unit 3 + more from 4 & 5
      let mc = [];
      let fib = [];

      // Unit 3 - take only a few
      mc.push(...shuffleArray([...(multipleChoiceByUnit[3] || [])]).slice(0, 4));
      fib.push(...shuffleArray([...(fillInTheBlankByUnit[3] || [])]).slice(0, 4));

      // Units 4 & 5 - take more
      [4, 5].forEach(u => {
        const mcPool = multipleChoiceByUnit[u] || [];
        const fibPool = fillInTheBlankByUnit[u] || [];

        mc.push(...shuffleArray([...mcPool]).slice(0, 8));
        fib.push(...shuffleArray([...fibPool]).slice(0, 8));
      });

      selectedQuestions = [...mc, ...fib];

      if (selectedQuestions.length < 14) {
        return res.status(400).json({
          error: `Not enough questions for Mid-2 (got only ${selectedQuestions.length}).`
        });
      }

      console.log(`Mid-2 generated: ${mc.length} MCQs + ${fib.length} FIBs`);
    } 
    else {
      return res.status(400).json({ error: 'Invalid paperType. Use "mid1" or "mid2".' });
    }

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
    console.error('Error generating questions:', error);
    res.status(500).json({ error: 'Error generating question paper: ' + error.message });
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
