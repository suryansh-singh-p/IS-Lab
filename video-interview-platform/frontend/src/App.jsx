import { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './context/AuthContext';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Admin from './pages/Admin';

const API_URL = import.meta.env.VITE_API_URL;

function getAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Default fallback questions (used only if API fails)
const defaultInterviewQuestions = [
  {
    id: 1,
    text: "Tell me a little about yourself and what motivates you to wake up in the morning."
  },
  {
    id: 2,
    text: "Tell me about a time you made a significant mistake at work. How did you handle it?"
  },
  {
    id: 3,
    text: "Describe a situation where you had to deal with a difficult coworker or client."
  },
  {
    id: 4,
    text: "Have you ever been assigned a task you felt was impossible? What did you do?"
  },
  {
    id: 5,
    text: "If we asked your previous manager to describe you in three words, what would they be and why?"
  },
  {
    id: 6,
    text: "Describe your ideal work environment."
  },
  {
    id: 7,
    text: "Tell me about a time you had to deliver bad news to a stakeholder."
  },
  {
    id: 8,
    text: "What is the one professional achievement you are most proud of?"
  },
  {
    id: 9,
    text: "Tell me about a time you had to learn a completely new tool or skill very quickly."
  },
  {
    id: 10,
    text: "Is there anything about this job description that makes you nervous?"
  }
];

// Function to play beep sound using Web Audio API
const playBeep = () => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.value = 800; // Frequency in Hz
  oscillator.type = 'sine';
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
  
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
};

function App() {
  const { user, token, isUser, isAdmin, logout, ready } = useAuth();

  // Page navigation state (synced with URL hash via effect below)
  const [currentPage, setCurrentPage] = useState('home');
  
  // Resume upload states
  const [interviewQuestions, setInterviewQuestions] = useState(defaultInterviewQuestions);
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [resumeUploadProgress, setResumeUploadProgress] = useState(0);
  const [resumeError, setResumeError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  
  // Candidate info states
  const [candidateName, setCandidateName] = useState('');
  const [candidateFolder, setCandidateFolder] = useState('');
  
  // State management
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [interviewComplete, setInterviewComplete] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [timeWarning, setTimeWarning] = useState(false); // Warning at 30 seconds left
  const [timeExpired, setTimeExpired] = useState(false); // Time is up
  const [interviewSessionId, setInterviewSessionId] = useState(null); // One session per full interview
  const [homeMessage, setHomeMessage] = useState(null); // Message on home (e.g. admin cannot interview)

  // Constants
  const MAX_RECORDING_TIME = 120; // 2 minutes in seconds
  const WARNING_TIME = 90; // Warning at 1:30 (30 seconds left)

  // Refs
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const currentQuestion = interviewQuestions[currentQuestionIndex];

  // Sync currentPage with URL hash (initial load + user clicks e.g. "Admin Panel" -> #admin)
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.slice(1) || 'home';
      const page = hash === 'interview' ? 'interview' : hash === 'login' ? 'login' : hash === 'signup' ? 'signup' : hash === 'admin' ? 'admin' : 'home';
      setCurrentPage(page);
    };
    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  // When already logged in as admin and landing on home (no hash or #home), show admin page directly
  useEffect(() => {
    if (!ready || !isAdmin) return;
    const hash = window.location.hash.slice(1) || 'home';
    if (hash === 'home' || hash === '') {
      setCurrentPage('admin');
      window.history.replaceState({}, '', '#admin');
    }
  }, [ready, isAdmin]);

  // Redirect if on interview page but not allowed (not logged in or admin)
  useEffect(() => {
    if (!ready) return;
    if (currentPage !== 'interview') return;
    if (!user) {
      setCurrentPage('login');
      window.history.pushState({}, '', '#login');
      return;
    }
    if (isAdmin) {
      setHomeMessage('Only users can give interviews.');
      setCurrentPage('home');
      window.history.pushState({}, '', '#');
    }
  }, [ready, currentPage, user, isAdmin]);

  // Redirect if on admin page but not admin
  useEffect(() => {
    if (!ready) return;
    if (currentPage !== 'admin') return;
    if (!user) {
      setCurrentPage('login');
      window.history.pushState({}, '', '#login');
      return;
    }
    if (!isAdmin) {
      setCurrentPage('home');
      window.history.pushState({}, '', '#');
    }
  }, [ready, currentPage, user, isAdmin]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const hash = window.location.hash.slice(1) || 'home';
      const page = hash === 'interview' ? 'interview' : hash === 'login' ? 'login' : hash === 'signup' ? 'signup' : hash === 'admin' ? 'admin' : 'home';
      
      // If navigating back to home, clean up
      if (page === 'home') {
        // Stop any ongoing recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        // Stop countdown if active
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
        }
        // Stop timer if active
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        // Stop camera
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        // Reset states
        setShowQuestion(false);
        setIsRecording(false);
        setIsCountingDown(false);
        setCountdown(0);
        setCurrentQuestionIndex(0);
        setRecordingTime(0);
        setTimeWarning(false);
        setTimeExpired(false);
        setCameraReady(false);
        // Reset resume states
        setResumeUploaded(false);
        setSelectedFile(null);
        setResumeError(null);
        setInterviewQuestions(defaultInterviewQuestions);
        setInterviewSessionId(null);
      }

      setCurrentPage(page);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Initialize camera on mount when on interview page AND resume is uploaded
  useEffect(() => {
    if (currentPage === 'interview' && resumeUploaded) {
      initializeCamera();
    }
    return () => {
      stopCamera();
    };
  }, [currentPage, resumeUploaded]);

  // Recording timer with auto-stop and warnings
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          
          // Warning at 1:30 (30 seconds remaining)
          if (newTime === WARNING_TIME && !timeWarning) {
            setTimeWarning(true);
            // Play warning beep
            playBeep();
          }
          
          // Auto-stop at 2 minutes
          if (newTime >= MAX_RECORDING_TIME) {
            setTimeExpired(true);
            // Play double beep for time up
            playBeep();
            setTimeout(() => playBeep(), 200);
            // Auto-stop recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
              setIsRecording(false);
              setIsPreviewing(true);
            }
            return MAX_RECORDING_TIME;
          }
          
          return newTime;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording, timeWarning]);

  const initializeCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: true
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
    } catch (err) {
      console.error('Camera initialization error:', err);
      setError('Unable to access camera. Please ensure camera permissions are granted.');
      setCameraReady(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
  };

  // Handle Start button click - show question and start countdown
  const handleStartClick = useCallback(async () => {
    setError(null);
    setUploadSuccess(false);

    // Create one session for the whole interview when starting the first question
    if (currentQuestionIndex === 0 && !interviewSessionId) {
      try {
        const sessionRes = await axios.post(`${API_URL}/sessions`, {}, {
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) }
        });
        if (sessionRes.data?.success && sessionRes.data?.data?.session_id) {
          setInterviewSessionId(sessionRes.data.data.session_id);
        }
      } catch (err) {
        console.warn('Session creation failed (uploads may still work):', err?.response?.data || err.message);
      }
    }

    setShowQuestion(true);
    setIsCountingDown(true);
    setCountdown(10);

    // Start countdown
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          setIsCountingDown(false);
          // Play beep and start recording
          playBeep();
          setTimeout(() => {
            actuallyStartRecording();
          }, 100);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [currentQuestionIndex, interviewSessionId]);

  // Actual recording start function
  const actuallyStartRecording = useCallback(() => {
    if (!streamRef.current) return;

    setRecordedChunks([]);
    setRecordingTime(0);
    setTimeWarning(false);
    setTimeExpired(false);

    const options = { mimeType: 'video/webm;codecs=vp9,opus' };
    
    // Fallback for browsers that don't support vp9
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm';
    }

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;

      const chunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        setRecordedChunks(chunks);
      };

      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      setIsPreviewing(false);
    } catch (err) {
      console.error('Recording error:', err);
      setError('Failed to start recording. Please try again.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPreviewing(true);
    }
  }, [isRecording]);

  const uploadVideo = useCallback(async () => {
    if (recordedChunks.length === 0) {
      setError('No recording to upload');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const formData = new FormData();
    formData.append('video', blob, `question-${currentQuestion.id}.webm`);
    formData.append('questionId', currentQuestion.id.toString());
    formData.append('questionText', currentQuestion.text);
    if (interviewSessionId) {
      formData.append('session_id', interviewSessionId);
    }

    try {
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...getAuthHeaders(token)
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(progress);
        }
      });

      if (response.data.success) {
        if (response.data.data?.sessionId && !interviewSessionId) {
          setInterviewSessionId(response.data.data.sessionId);
        }
        setUploadSuccess(true);
        setRecordedChunks([]);
        setIsPreviewing(false);

        // Move to next question or complete interview
        setTimeout(() => {
          if (currentQuestionIndex < interviewQuestions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
            setUploadSuccess(false);
            setShowQuestion(false); // Reset for next question
          } else {
            setInterviewComplete(true);
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [recordedChunks, currentQuestion, currentQuestionIndex, interviewSessionId]);

  const retakeRecording = () => {
    setRecordedChunks([]);
    setIsPreviewing(false);
    setRecordingTime(0);
    setUploadSuccess(false);
    setShowQuestion(false);
    setIsCountingDown(false);
    setCountdown(0);
    setTimeWarning(false);
    setTimeExpired(false);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handler to start interview from landing page (only for role user)
  const handleStartInterview = () => {
    setHomeMessage(null);
    if (!user) {
      setCurrentPage('login');
      return;
    }
    if (isAdmin) {
      setHomeMessage('Only users can give interviews. Use Admin Panel to view results.');
      return;
    }
    window.history.pushState({ page: 'interview' }, '', '#interview');
    setCurrentPage('interview');
  };

  // Handler to go back to home
  const handleBackToHome = () => {
    // Stop camera and any ongoing recording
    if (isRecording) {
      stopRecording();
    }
    if (isCountingDown && countdownRef.current) {
      clearInterval(countdownRef.current);
      setIsCountingDown(false);
      setCountdown(0);
    }
    stopCamera();
    
    // Reset states
    setShowQuestion(false);
    setCurrentQuestionIndex(0);
    setRecordingTime(0);
    setTimeWarning(false);
    setTimeExpired(false);
    // Reset resume states
    setResumeUploaded(false);
    setSelectedFile(null);
    setResumeError(null);
    setInterviewQuestions(defaultInterviewQuestions);
    setInterviewSessionId(null);

    // Navigate back
    window.history.pushState({ page: 'home' }, '', '#');
    setCurrentPage('home');
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        setResumeError('Please select a PDF file');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setResumeError('File size must be less than 10MB');
        return;
      }
      setSelectedFile(file);
      setResumeError(null);
    }
  };

  // Handle resume upload and question generation
  const handleResumeUpload = async () => {
    if (!selectedFile) {
      setResumeError('Please select a PDF file first');
      return;
    }

    setIsUploadingResume(true);
    setResumeUploadProgress(0);
    setResumeError(null);

    const formData = new FormData();
    formData.append('resume', selectedFile);

    try {
      const response = await axios.post(`${API_URL}/generate-questions`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...getAuthHeaders(token)
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setResumeUploadProgress(progress);
        }
      });

      if (response.data.success && response.data.data.questions) {
        setInterviewQuestions(response.data.data.questions);
        setCandidateName(response.data.data.candidateName || 'Unknown');
        setCandidateFolder(response.data.data.candidateFolder || '');
        setResumeUploaded(true);
        console.log('Candidate:', response.data.data.candidateName);
        console.log('Folder:', response.data.data.candidateFolder);
        console.log('Personalized questions loaded:', response.data.data.questions.length, 'questions');
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Resume upload error:', err);
      setResumeError(err.response?.data?.message || 'Failed to generate questions. Please try again.');
      // Don't fall back to default - let user retry
    } finally {
      setIsUploadingResume(false);
    }
  };

  // Login / Signup pages
  if (currentPage === 'login') {
    return (
      <Login
        onSuccess={(user) => {
          const page = user?.role === 'admin' ? 'admin' : 'home';
          setCurrentPage(page);
          window.history.pushState({}, '', page === 'admin' ? '#admin' : '#');
        }}
        onGoSignup={() => { window.history.pushState({}, '', '#signup'); setCurrentPage('signup'); }}
      />
    );
  }
  if (currentPage === 'signup') {
    return (
      <Signup
        onSuccess={(user) => {
          const page = user?.role === 'admin' ? 'admin' : 'home';
          setCurrentPage(page);
          window.history.pushState({}, '', page === 'admin' ? '#admin' : '#');
        }}
        onGoLogin={() => { window.history.pushState({}, '', '#login'); setCurrentPage('login'); }}
      />
    );
  }

  // Show landing page
  if (currentPage === 'home') {
    return (
      <Home
        user={user}
        isUser={isUser}
        isAdmin={isAdmin}
        homeMessage={homeMessage}
        onStartInterview={handleStartInterview}
        onLogin={() => { setHomeMessage(null); window.history.pushState({}, '', '#login'); setCurrentPage('login'); }}
        onSignup={() => { setHomeMessage(null); window.history.pushState({}, '', '#signup'); setCurrentPage('signup'); }}
        onLogout={logout}
      />
    );
  }

  if (currentPage === 'admin') {
    return <Admin />;
  }

  // Resume Upload Screen (before interview starts)
  if (currentPage === 'interview' && !resumeUploaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
          {/* Back button */}
          <button
            onClick={handleBackToHome}
            className="mb-6 flex items-center text-slate-600 hover:text-blue-600 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </button>
          
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Upload Your Resume</h1>
            <p className="text-slate-600">
              Upload your resume/CV to receive personalized interview questions tailored to your experience.
            </p>
          </div>

          {/* File upload area */}
          <div 
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              selectedFile 
                ? 'border-green-400 bg-green-50' 
                : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            {selectedFile ? (
              <div>
                <svg className="w-12 h-12 text-green-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-green-700 font-medium">{selectedFile.name}</p>
                <p className="text-green-600 text-sm mt-1">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
                <p className="text-slate-500 text-sm mt-2">Click to change file</p>
              </div>
            ) : (
              <div>
                <svg className="w-12 h-12 text-slate-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-slate-600 font-medium">Click to upload PDF</p>
                <p className="text-slate-500 text-sm mt-1">or drag and drop</p>
                <p className="text-slate-400 text-xs mt-2">Maximum file size: 10MB</p>
              </div>
            )}
          </div>

          {/* Error message */}
          {resumeError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-700 text-sm">{resumeError}</p>
            </div>
          )}

          {/* Upload progress */}
          {isUploadingResume && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">Generating personalized questions...</span>
                <span className="text-sm font-medium text-blue-600">{resumeUploadProgress}%</span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${resumeUploadProgress}%` }}
                />
              </div>
              <p className="text-slate-500 text-sm mt-2 text-center">
                Analyzing your resume and creating tailored questions...
              </p>
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleResumeUpload}
            disabled={!selectedFile || isUploadingResume}
            className="w-full mt-6 px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transition-all duration-200 flex items-center justify-center space-x-2"
          >
            {isUploadingResume ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Generate Personalized Questions</span>
              </>
            )}
          </button>

          {/* Info text */}
          <p className="text-center text-slate-500 text-sm mt-4">
            Your resume will be analyzed by AI to create interview questions specific to your skills and experience.
          </p>
        </div>
      </div>
    );
  }

  // Interview Complete Screen
  if (interviewComplete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-12 max-w-lg text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-4">Interview Complete!</h1>
          <p className="text-slate-600 mb-8">
            Thank you for completing your video interview. Our team will review your responses and get back to you soon.
          </p>
          <button
            onClick={() => {
              setInterviewComplete(false);
              setCurrentQuestionIndex(0);
              setResumeUploaded(false);
              setSelectedFile(null);
              setInterviewQuestions(defaultInterviewQuestions);
              setCandidateName(null);
              setCandidateFolder(null);
              window.history.pushState({ page: 'home' }, '', '#');
              setCurrentPage('home');
            }}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* Back to Home Button */}
              <button
                onClick={handleBackToHome}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors group"
                title="Back to Home"
              >
                <svg className="w-6 h-6 text-slate-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Video Interview</h1>
                <p className="text-sm text-slate-500">Pre-Selection Assessment</p>
              </div>
            </div>
            
            {/* Progress indicator */}
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex items-center space-x-1">
                {interviewQuestions.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${
                      index < currentQuestionIndex
                        ? 'bg-green-500'
                        : index === currentQuestionIndex
                        ? 'bg-blue-600'
                        : 'bg-slate-300'
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm font-medium text-slate-600">
                Question {currentQuestionIndex + 1} of {interviewQuestions.length}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Video Container */}
        <div className="relative bg-slate-900 rounded-2xl overflow-hidden shadow-2xl">
          {/* Aspect ratio container */}
          <div className="relative aspect-video">
            {/* Video element */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Recording indicator with time warning */}
            {isRecording && (
              <div className={`absolute top-6 left-6 flex items-center space-x-3 backdrop-blur-sm px-4 py-2 rounded-full transition-all duration-300 ${
                timeWarning ? 'bg-red-500/70 animate-pulse' : 'bg-black/50'
              }`}>
                <span className="relative flex h-3 w-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    timeWarning ? 'bg-white' : 'bg-red-400'
                  }`}></span>
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${
                    timeWarning ? 'bg-white' : 'bg-red-500'
                  }`}></span>
                </span>
                <span className="text-white font-medium text-sm">REC</span>
                <span className={`text-sm font-mono ${timeWarning ? 'text-white font-bold' : 'text-white/80'}`}>
                  {formatTime(recordingTime)}
                </span>
                {/* Remaining time indicator */}
                <span className={`text-sm ${timeWarning ? 'text-white font-bold' : 'text-white/60'}`}>
                  / {formatTime(MAX_RECORDING_TIME)}
                </span>
              </div>
            )}

            {/* Time warning banner */}
            {isRecording && timeWarning && (
              <div className="absolute top-6 right-6 bg-red-500 text-white px-4 py-2 rounded-full animate-bounce">
                <span className="font-bold text-sm">⚠️ {MAX_RECORDING_TIME - recordingTime}s remaining!</span>
              </div>
            )}

            {/* Countdown overlay */}
            {isCountingDown && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20">
                <div className="text-center">
                  <div className="w-32 h-32 rounded-full border-4 border-blue-500 flex items-center justify-center mb-4 mx-auto">
                    <span className="text-6xl font-bold text-white">{countdown}</span>
                  </div>
                  <p className="text-white text-xl font-medium">Get Ready!</p>
                  <p className="text-white/70 text-sm mt-2">Recording starts in {countdown} seconds</p>
                </div>
              </div>
            )}

            {/* Question Overlay - Bottom (only show after clicking start) */}
            {showQuestion && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/60 to-transparent p-6 pt-16">
                <div className="max-w-3xl mx-auto">
                  {/* Question card */}
                  <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-6">
                    <div className="flex items-start space-x-4">
                      <div className="flex-shrink-0 w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                        <span className="text-blue-400 font-bold">Q{currentQuestion.id}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-lg sm:text-xl font-medium leading-relaxed">
                          {currentQuestion.text}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Camera not ready overlay */}
            {!cameraReady && (
              <div className="absolute inset-0 bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-white text-lg">Initializing camera...</p>
                  <p className="text-slate-400 text-sm mt-2">Please allow camera access when prompted</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center space-x-3">
            <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Time expired message */}
        {timeExpired && isPreviewing && (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center space-x-3">
            <svg className="w-6 h-6 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-amber-700">
              <span className="font-semibold">Time's up!</span> Your 2-minute recording has been automatically saved. Review and submit your answer, or retake if needed.
            </p>
          </div>
        )}

        {/* Success message */}
        {uploadSuccess && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center space-x-3">
            <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-green-700">Video uploaded successfully! Moving to next question...</p>
          </div>
        )}

        {/* Controls */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          {!isRecording && !isPreviewing && !isCountingDown && (
            <button
              onClick={handleStartClick}
              disabled={!cameraReady}
              className="w-full sm:w-auto px-8 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/40 transition-all duration-200 flex items-center justify-center space-x-3"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
              </svg>
              <span>Start</span>
            </button>
          )}

          {isRecording && (
            <button
              onClick={stopRecording}
              className="w-full sm:w-auto px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl shadow-lg shadow-red-500/30 hover:shadow-red-500/40 transition-all duration-200 flex items-center justify-center space-x-3 animate-pulse"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <span>Stop Recording</span>
            </button>
          )}

          {isPreviewing && !isUploading && (
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <button
                onClick={retakeRecording}
                className="w-full sm:w-auto px-8 py-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center space-x-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Retake</span>
              </button>
              <button
                onClick={uploadVideo}
                className="w-full sm:w-auto px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-lg shadow-green-500/30 hover:shadow-green-500/40 transition-all duration-200 flex items-center justify-center space-x-3"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Submit Answer</span>
              </button>
            </div>
          )}

          {isUploading && (
            <div className="w-full max-w-md">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">Uploading video...</span>
                <span className="text-sm font-medium text-blue-600">{uploadProgress}%</span>
              </div>
              <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Instructions Card */}
        <div className="mt-12 bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center space-x-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Interview Instructions</span>
          </h3>
          
          {/* Time info banner */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="flex items-center space-x-3">
              <svg className="w-6 h-6 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-blue-800 font-medium">All questions have a 2-minute response time</p>
            </div>
          </div>

          <ul className="space-y-3 text-slate-600">
            <li className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Click "Start" to see the question - recording begins after 10 seconds (you'll hear a beep)</span>
            </li>
            <li className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Ensure you are in a well-lit, quiet environment</span>
            </li>
            <li className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Look directly at the camera when speaking</span>
            </li>
            <li className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Speak clearly and at a moderate pace</span>
            </li>
            <li className="flex items-start space-x-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>You can retake your answer before submitting if needed</span>
            </li>
          </ul>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-16 py-8 border-t border-slate-200 bg-white/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-slate-500 text-sm">
          <p>© 2026 Video Interview Platform. All rights reserved.</p>
          <p className="mt-1">Your privacy is important to us. All recordings are securely stored.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
