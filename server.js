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
        if (!questionKey) {
            return res.status(400).json({ error: 'No "Question" column found in the Excel file' });
        }

        // Process questions and assign types based on question format
        const questionBank = jsonData.map(row => {
            let questionText = row[questionKey] ? row[questionKey].toString().trim() : '';
            let type = 'fill-in-the-blank';

            // Check if the question contains options (indicating multiple-choice)
            const normalizedQuestion = questionText.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
            const lines = normalizedQuestion.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            const hasOptions = lines.slice(1).some(line => /^[A-D][\.\)]\s+/.test(line));
            if (hasOptions) {
                type = 'multiple-choice';
            }

            return {
                subjectCode: row['Subject Code'] || '',
                subject: row['Subject'] || '',
                branch: row['Branch'] || '',
                regulation: row['Regulation'] || '',
                year: row['Year'] || 0,
                semester: row['Sem'] || 0,
                month: row['Month'] || '',
                unit: parseInt(row['Unit']) || 0,
                question: questionText,
                imageUrl: row['Image Url'] || null,
                type: type
            };
        }).filter(q => q.subjectCode && q.question && q.unit > 0); // Filter out invalid rows

        if (questionBank.length === 0) {
            return res.status(400).json({ error: 'No valid questions found in the Excel file' });
        }

        // Organize questions by unit and type
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

        console.log('Multiple Choice Questions by Unit:', {
            Unit1: multipleChoiceByUnit[1].length,
            Unit2: multipleChoiceByUnit[2].length,
            Unit3: multipleChoiceByUnit[3].length,
            Unit4: multipleChoiceByUnit[4].length,
            Unit5: multipleChoiceByUnit[5].length
        });
        console.log('Fill-in-the-Blank Questions by Unit:', {
            Unit1: fillInTheBlankByUnit[1].length,
            Unit2: fillInTheBlankByUnit[2].length,
            Unit3: fillInTheBlankByUnit[3].length,
            Unit4: fillInTheBlankByUnit[4].length,
            Unit5: fillInTheBlankByUnit[5].length
        });

        let selectedQuestions = [];
        if (paperType === 'mid1') {
            // Mid 1: 4 MCQs + 4 FIBs from Unit 1, 4 MCQs + 4 FIBs from Unit 2, 2 MCQs + 2 FIBs from Unit 3 (first half)
            if (multipleChoiceByUnit[1].length < 4 || multipleChoiceByUnit[2].length < 4 || multipleChoiceByUnit[3].length < 10) {
                return res.status(400).json({ 
                    error: `Insufficient multiple-choice questions for Mid 1: Need 4 from Unit 1 (found ${multipleChoiceByUnit[1].length}), 4 from Unit 2 (found ${multipleChoiceByUnit[2].length}), 10 from Unit 3 (found ${multipleChoiceByUnit[3].length})` 
                });
            }
            if (fillInTheBlankByUnit[1].length < 4 || fillInTheBlankByUnit[2].length < 4 || fillInTheBlankByUnit[3].length < 10) {
                return res.status(400).json({ 
                    error: `Insufficient fill-in-the-blank questions for Mid 1: Need 4 from Unit 1 (found ${fillInTheBlankByUnit[1].length}), 4 from Unit 2 (found ${fillInTheBlankByUnit[2].length}), 10 from Unit 3 (found ${fillInTheBlankByUnit[3].length})` 
                });
            }

            selectedQuestions = [
                ...shuffleArray([...multipleChoiceByUnit[1]]).slice(0, 4), // 4 MCQs from Unit 1
                ...shuffleArray([...multipleChoiceByUnit[2]]).slice(0, 4), // 4 MCQs from Unit 2
                ...shuffleArray([...multipleChoiceByUnit[3].slice(0, 10)]).slice(0, 2), // 2 MCQs from Unit 3 (first 10)
                ...shuffleArray([...fillInTheBlankByUnit[1]]).slice(0, 4), // 4 FIBs from Unit 1
                ...shuffleArray([...fillInTheBlankByUnit[2]]).slice(0, 4), // 4 FIBs from Unit 2
                ...shuffleArray([...fillInTheBlankByUnit[3].slice(0, 10)]).slice(0, 2) // 2 FIBs from Unit 3 (first 10)
            ];

            console.log('Mid 1 Selection Breakdown:', {
                'Q1-Q4 (MC, Unit 1)': selectedQuestions.slice(0, 4),
                'Q5-Q8 (MC, Unit 2)': selectedQuestions.slice(4, 8),
                'Q9-Q10 (MC, Unit 3)': selectedQuestions.slice(8, 10),
                'Q11-Q14 (FIB, Unit 1)': selectedQuestions.slice(10, 14),
                'Q15-Q18 (FIB, Unit 2)': selectedQuestions.slice(14, 18),
                'Q19-Q20 (FIB, Unit 3)': selectedQuestions.slice(18, 20)
            });
        } else if (paperType === 'mid2') {
            // Mid 2: 4 MCQs + 4 FIBs from Unit 4, 4 MCQs + 4 FIBs from Unit 5, 2 MCQs + 2 FIBs from Unit 3 (second half)
            if (multipleChoiceByUnit[3].length < 20 || multipleChoiceByUnit[4].length < 4 || multipleChoiceByUnit[5].length < 4) {
                return res.status(400).json({ 
                    error: `Insufficient multiple-choice questions for Mid 2: Need 10 from Unit 3 (found ${multipleChoiceByUnit[3].length}), 4 from Unit 4 (found ${multipleChoiceByUnit[4].length}), 4 from Unit 5 (found ${multipleChoiceByUnit[5].length})` 
                });
            }
            if (fillInTheBlankByUnit[3].length < 20 || fillInTheBlankByUnit[4].length < 4 || fillInTheBlankByUnit[5].length < 4) {
                return res.status(400).json({ 
                    error: `Insufficient fill-in-the-blank questions for Mid 2: Need 10 from Unit 3 (found ${fillInTheBlankByUnit[3].length}), 4 from Unit 4 (found ${fillInTheBlankByUnit[4].length}), 4 from Unit 5 (found ${fillInTheBlankByUnit[5].length})` 
                });
            }

            selectedQuestions = [
                ...shuffleArray([...multipleChoiceByUnit[3].slice(10, 20)]).slice(0, 2), // 2 MCQs from Unit 3 (second 10)
                ...shuffleArray([...multipleChoiceByUnit[4]]).slice(0, 4), // 4 MCQs from Unit 4
                ...shuffleArray([...multipleChoiceByUnit[5]]).slice(0, 4), // 4 MCQs from Unit 5
                ...shuffleArray([...fillInTheBlankByUnit[3].slice(10, 20)]).slice(0, 2), // 2 FIBs from Unit 3 (second 10)
                ...shuffleArray([...fillInTheBlankByUnit[4]]).slice(0, 4), // 4 FIBs from Unit 4
                ...shuffleArray([...fillInTheBlankByUnit[5]]).slice(0, 4) // 4 FIBs from Unit 5
            ];

            console.log('Mid 2 Selection Breakdown:', {
                'Q1-Q2 (MC, Unit 3)': selectedQuestions.slice(0, 2),
                'Q3-Q6 (MC, Unit 4)': selectedQuestions.slice(2, 6),
                'Q7-Q10 (MC, Unit 5)': selectedQuestions.slice(6, 10),
                'Q11-Q12 (FIB, Unit 3)': selectedQuestions.slice(10, 12),
                'Q13-Q16 (FIB, Unit 4)': selectedQuestions.slice(12, 16),
                'Q17-Q20 (FIB, Unit 5)': selectedQuestions.slice(16, 20)
            });
        } else {
            return res.status(400).json({ error: 'Invalid paperType. Use "mid1" or "mid2".' });
        }

        const paperDetails = {
            subjectCode: selectedQuestions[0].subjectCode,
            subject: selectedQuestions[0].subject,
            branch: selectedQuestions[0].branch,
            regulation: selectedQuestions[0].regulation,
            year: selectedQuestions[0].year,
            semester: selectedQuestions[0].semester,
            month: selectedQuestions[0].month
        };

        const response = {
            paperDetails,
            questions: selectedQuestions.map(q => ({
                question: q.question,
                unit: q.unit,
                imageUrl: q.imageUrl,
                type: q.type
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
