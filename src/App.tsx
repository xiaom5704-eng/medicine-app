import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Upload, 
  Trash2, 
  Camera, 
  Send, 
  History, 
  ChevronRight, 
  Stethoscope, 
  Pill, 
  AlertCircle,
  Loader2,
  X,
  Pin,
  MoreVertical,
  Edit2,
  Mic,
  Volume2,
  Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session, Message, MedicationFile } from './types';
import { analyzeMedications, getSymptomAdvice, chatWithAI, generateTitleSummary, testGeminiKey } from './services/gemini';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Speech states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingText, setSpeakingText] = useState<string | null>(null);

  // TTS
  const speak = (text: string) => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      if (speakingText === text) {
        setIsSpeaking(false);
        setSpeakingText(null);
        return;
      }
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    
    // Try to find a Taiwan female voice
    const voices = window.speechSynthesis.getVoices();
    const twVoice = voices.find(v => v.lang.includes('zh-TW') && (v.name.includes('Female') || v.name.includes('Google') || v.name.includes('Mei-Jia')));
    if (twVoice) utterance.voice = twVoice;
    
    utterance.onstart = () => {
      setIsSpeaking(true);
      setSpeakingText(text);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingText(null);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingText(null);
    };
    
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setSpeakingText(null);
  };

  // STT
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('您的瀏覽器不支援語音辨識功能。');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText(prev => prev + transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);
  const [medFiles, setMedFiles] = useState<MedicationFile[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'medication' | 'symptoms'>('chat');
  const [symptomMode, setSymptomMode] = useState<'concise' | 'detailed'>('concise');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [userApiKey, setUserApiKey] = useState('');
  const [isOllamaOnline, setIsOllamaOnline] = useState<boolean | null>(null);
  const [ollamaModel, setOllamaModel] = useState<string | null>(null);
  const [isGeminiValid, setIsGeminiValid] = useState<boolean>(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<'success' | 'error' | null>(null);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(() => {
    const lastAccepted = localStorage.getItem('disclaimerAcceptedAt');
    if (lastAccepted) {
      const lastAcceptedTime = parseInt(lastAccepted, 10);
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (now - lastAcceptedTime < twentyFourHours) {
        return false;
      }
    }
    return true;
  });
  const [apiMetrics, setApiMetrics] = useState({
    totalRequests: 0,
    successfulRequests: 0,
    totalLatencyMs: 0
  });

  const trackApiCall = async <T,>(apiCall: () => Promise<T>): Promise<T> => {
    const startTime = Date.now();
    setApiMetrics(prev => ({ ...prev, totalRequests: prev.totalRequests + 1 }));
    try {
      const result = await apiCall();
      const latency = Date.now() - startTime;
      setApiMetrics(prev => ({
        ...prev,
        successfulRequests: prev.successfulRequests + 1,
        totalLatencyMs: prev.totalLatencyMs + latency
      }));
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      setApiMetrics(prev => ({
        ...prev,
        totalLatencyMs: prev.totalLatencyMs + latency
      }));
      throw error;
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions();
    checkOllamaStatus();
    const interval = setInterval(checkOllamaStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const checkOllamaStatus = async () => {
    try {
      const res = await fetch('/api/ai/ollama/status');
      const data = await res.json();
      setIsOllamaOnline(data.status === 'online');
      if (data.status === 'online' && data.model) {
        setOllamaModel(data.model);
      } else {
        setOllamaModel(null);
      }
    } catch (e) {
      setIsOllamaOnline(false);
      setOllamaModel(null);
    }
  };

  const handleTestKey = async () => {
    if (!userApiKey.trim()) return;
    setIsTestingKey(true);
    setKeyTestResult(null);
    const isValid = await trackApiCall(() => testGeminiKey(userApiKey));
    setIsGeminiValid(isValid);
    setKeyTestResult(isValid ? 'success' : 'error');
    setIsTestingKey(false);
  };

  useEffect(() => {
    if (currentSessionId) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
    setSymptomResult(null);
    setMedFiles([]);
    setInputText('');
    stopSpeaking();
  }, [currentSessionId]);

  useEffect(() => {
    stopSpeaking();
  }, [activeTab]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = () => setActiveMenuId(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    }
  };

  const fetchMessages = async (id: string) => {
    try {
      const res = await fetch(`/api/messages/${id}`);
      const data = await res.json();
      setMessages(data);
    } catch (e) {
      console.error("Failed to fetch messages", e);
    }
  };

  const createNewSession = async () => {
    const id = Date.now().toString();
    const title = `新對話 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title }),
      });
      fetchSessions();
      setCurrentSessionId(id);
      setActiveTab('chat');
    } catch (e) {
      console.error("Failed to create session", e);
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      fetchSessions();
      if (currentSessionId === id) setCurrentSessionId(null);
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const togglePin = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: !session.is_pinned }),
      });
      fetchSessions();
      setActiveMenuId(null);
    } catch (e) {
      console.error("Failed to toggle pin", e);
    }
  };

  const openRenameDialog = (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingSession(session);
    setNewTitle(session.title);
    setIsRenameDialogOpen(true);
    setActiveMenuId(null);
  };

  const handleRename = async () => {
    if (!renamingSession || !newTitle.trim()) return;
    try {
      await fetch(`/api/sessions/${renamingSession.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, is_manual_title: 1 }),
      });
      fetchSessions();
      setIsRenameDialogOpen(false);
      setRenamingSession(null);
    } catch (e) {
      console.error("Failed to rename session", e);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const startingSessionId = currentSessionId;
    let sessionId = startingSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      const title = `新對話 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title }),
      });
      fetchSessions();
      if (currentSessionIdRef.current === startingSessionId) {
        setCurrentSessionId(sessionId);
      }
    }

    const userMsg: Message = { session_id: sessionId, role: 'user', content: inputText };
    
    if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
      setMessages(prev => [...prev, userMsg]);
      setInputText('');
    }
    setIsLoading(true);

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userMsg),
      });

      const aiResponse = await trackApiCall(() => chatWithAI(
        messages.map(m => ({ role: m.role, content: m.content })), 
        inputText,
        userApiKey
      ));
      const aiMsg: Message = { session_id: sessionId, role: 'assistant', content: aiResponse || '抱歉，我現在無法回答。' };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
        setMessages(prev => [...prev, aiMsg]);
      }

      // Auto-titling logic
      const currentSession = sessions.find(s => s.id === sessionId);
      const isNewSession = !startingSessionId;
      const isDefaultTitle = currentSession ? (currentSession.title.startsWith('新對話') || currentSession.title.startsWith('藥物分析') || currentSession.title.startsWith('症狀諮詢')) : true;
      const isManualTitle = currentSession ? currentSession.is_manual_title : false;

      if (isNewSession || (currentSession && !isManualTitle && isDefaultTitle)) {
        const generatedTitle = await trackApiCall(() => generateTitleSummary(inputText, aiResponse || '', userApiKey));
        if (generatedTitle) {
          await fetch(`/api/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: generatedTitle, is_manual_title: 0 }),
          });
          fetchSessions();
        }
      }

    } catch (error) {
      console.error(error);
    } finally {
      if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
        setIsLoading(false);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    
    setMedFiles(prev => {
      const availableSlots = 4 - prev.length;
      if (availableSlots <= 0) return prev;
      
      const filesToAdd = newFiles.slice(0, availableSlots);
      
      filesToAdd.forEach((file: File) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setMedFiles(current => {
            if (current.length >= 4) return current;
            return [...current, {
              id: Math.random().toString(36).substr(2, 9),
              preview: reader.result as string,
              name: file.name
            }];
          });
        };
        reader.readAsDataURL(file);
      });
      
      return prev;
    });
  };

  const removeFile = (id: string) => {
    setMedFiles(prev => prev.filter(f => f.id !== id));
  };

  const [symptomResult, setSymptomResult] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('繁體中文');
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("無法啟動相機，請檢查權限設定。");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const takePhoto = () => {
    if (medFiles.length >= 4) {
      alert("最多只能上傳 4 張照片");
      return;
    }
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setMedFiles(prev => {
          if (prev.length >= 4) return prev;
          return [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            preview: dataUrl,
            name: `相機拍攝_${new Date().getTime()}.jpg`
          }];
        });
        stopCamera();
      }
    }
  };

  const handleAnalyzeMedications = async () => {
    if (medFiles.length === 0) return;
    setIsLoading(true);
    
    const startingSessionId = currentSessionId;
    let sessionId = startingSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      const title = `藥物分析 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title }),
      });
      fetchSessions();
      if (currentSessionIdRef.current === startingSessionId) {
        setCurrentSessionId(sessionId);
      }
    }

    try {
      const result = await trackApiCall(() => analyzeMedications(medFiles.map(f => f.preview), targetLanguage, userApiKey));
      
      const userMsg: Message = {
        session_id: sessionId,
        role: 'user',
        content: `[上傳了 ${medFiles.length} 張藥物照片進行分析]`
      };
      const aiMsg: Message = { 
        session_id: sessionId, 
        role: 'assistant', 
        content: `### 藥物分析與翻譯報告 (${targetLanguage})\n\n${result}` 
      };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userMsg),
      });

      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
        setMessages(prev => [...prev, userMsg, aiMsg]);
        setActiveTab('chat');
        setMedFiles([]);
      }

      // Auto-titling logic
      const currentSession = sessions.find(s => s.id === sessionId);
      const isNewSession = !startingSessionId;
      const isDefaultTitle = currentSession ? (currentSession.title.startsWith('新對話') || currentSession.title.startsWith('藥物分析') || currentSession.title.startsWith('症狀諮詢')) : true;
      const isManualTitle = currentSession ? currentSession.is_manual_title : false;

      if (isNewSession || (currentSession && !isManualTitle && isDefaultTitle)) {
        const generatedTitle = await trackApiCall(() => generateTitleSummary('請幫我分析這些藥物', result, userApiKey));
        if (generatedTitle) {
          await fetch(`/api/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: generatedTitle, is_manual_title: 0 }),
          });
          fetchSessions();
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
        setIsLoading(false);
      }
    }
  };

  const handleSymptomSubmit = async (symptoms: string) => {
    if (!symptoms.trim()) return;
    setIsLoading(true);
    setSymptomResult(null);

    const startingSessionId = currentSessionId;
    let sessionId = startingSessionId;

    try {
      const result = await trackApiCall(() => getSymptomAdvice(symptoms, symptomMode, userApiKey));
      
      // Only show result if we haven't switched sessions
      if (currentSessionIdRef.current === startingSessionId) {
        setSymptomResult(result);
      }
      
      // Still save to history for record keeping
      if (!sessionId) {
        sessionId = Date.now().toString();
        const title = `症狀諮詢 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
        await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, title }),
        });
        fetchSessions();
        // Only switch to the new session if the user hasn't manually switched to another one
        if (currentSessionIdRef.current === startingSessionId) {
          setCurrentSessionId(sessionId);
        }
      }

      const userMsg: Message = {
        session_id: sessionId,
        role: 'user',
        content: `[症狀諮詢 - ${symptomMode === 'concise' ? '簡潔' : '詳細'}]\n${symptoms}`
      };
      const aiMsg: Message = { 
        session_id: sessionId, 
        role: 'assistant', 
        content: `### 症狀建議 (${symptomMode === 'concise' ? '簡潔' : '詳細'})\n\n${result}` 
      };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userMsg),
      });

      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      // Only update messages state if we are currently viewing this session
      if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
        setMessages(prev => [...prev, userMsg, aiMsg]);
      }

      // Auto-titling logic
      const currentSession = sessions.find(s => s.id === sessionId);
      const isNewSession = !startingSessionId;
      const isDefaultTitle = currentSession ? (currentSession.title.startsWith('新對話') || currentSession.title.startsWith('藥物分析') || currentSession.title.startsWith('症狀諮詢')) : true;
      const isManualTitle = currentSession ? currentSession.is_manual_title : false;

      if (isNewSession || (currentSession && !isManualTitle && isDefaultTitle)) {
        const generatedTitle = await trackApiCall(() => generateTitleSummary(symptoms, result, userApiKey));
        if (generatedTitle) {
          await fetch(`/api/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: generatedTitle, is_manual_title: 0 }),
          });
          fetchSessions();
        }
      }

    } catch (error) {
      console.error(error);
    } finally {
      if (currentSessionIdRef.current === startingSessionId || currentSessionIdRef.current === sessionId) {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-800 font-sans">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-slate-200 overflow-hidden flex flex-col"
      >
        <div className="p-4 border-bottom border-slate-100">
          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-2xl transition-all shadow-md font-bold text-lg"
          >
            <Plus size={20} />
            建立新對話
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map(session => (
            <div 
              key={session.id}
              onClick={() => setCurrentSessionId(session.id)}
              className={`group relative flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${currentSessionId === session.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3 overflow-hidden flex-1">
                {!!session.is_pinned && (
                  <Pin size={14} className="text-emerald-600 fill-emerald-600 shrink-0" />
                )}
                <span className="truncate text-sm font-medium">{session.title}</span>
              </div>
              
              <div className="flex items-center gap-1">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMenuId(activeMenuId === session.id ? null : session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded-md transition-all text-slate-400"
                >
                  <MoreVertical size={14} />
                </button>
              </div>

              {activeMenuId === session.id && (
                <div className="absolute right-2 top-10 w-32 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
                  <button 
                    onClick={(e) => togglePin(session, e)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-600"
                  >
                    <Pin size={12} />
                    {session.is_pinned ? '取消釘選' : '釘選至頂部'}
                  </button>
                  <button 
                    onClick={(e) => openRenameDialog(session, e)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-600"
                  >
                    <Edit2 size={12} />
                    重新命名
                  </button>
                  <button 
                    onClick={(e) => deleteSession(session.id, e)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-red-50 text-red-600"
                  >
                    <Trash2 size={12} />
                    刪除對話
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 flex flex-col gap-2">
          <button 
            onClick={() => setShowGuideModal(true)}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-600 transition-colors p-2 rounded-lg hover:bg-slate-50"
          >
            <AlertCircle size={16} />
            使用指南
          </button>
          <div className="text-xs text-slate-400 text-center">
            智慧醫療助理 v1.0
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
            >
              <History size={20} />
            </button>
            <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Stethoscope className="text-emerald-600" size={22} />
              智慧醫療助理
            </h1>
          </div>

          <div className="flex items-center gap-4">
            {/* AI Status Box */}
            <div className="hidden md:flex items-center bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-lg text-sm font-medium border border-emerald-100">
              當前狀態：{isOllamaOnline ? '一般生活助手 (Ollama 本地端)' : (isGeminiValid ? '一般生活助手 (Gemini 雲端)' : '未連線 AI')}
            </div>

            {/* Indicators */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="relative group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-600 cursor-help">
                <div className={`w-2 h-2 rounded-full ${isOllamaOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                Ollama
                {isOllamaOnline && ollamaModel && (
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    目前模型：{ollamaModel}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-600">
                <div className={`w-2 h-2 rounded-full ${isGeminiValid ? 'bg-blue-500' : 'bg-slate-300'}`} />
                Gemini
              </div>
            </div>

            {/* Config Button */}
            <button 
              onClick={() => setShowApiKeyInput(!showApiKeyInput)}
              className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-200"
            >
              配置金鑰
            </button>

            {/* Tabs */}
            <nav className="hidden lg:flex bg-slate-100 p-1 rounded-xl ml-2">
              <button 
                onClick={() => setActiveTab('chat')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'chat' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                對話模式
              </button>
              <button 
                onClick={() => setActiveTab('medication')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'medication' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                藥物辨識
              </button>
              <button 
                onClick={() => setActiveTab('symptoms')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'symptoms' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                症狀諮詢
              </button>
            </nav>
          </div>
        </header>

        {/* API Key Input Overlay */}
        <AnimatePresence>
          {showApiKeyInput && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-16 left-0 right-0 bg-white border-b border-slate-200 p-6 z-20 shadow-lg"
            >
              <div className="max-w-3xl mx-auto flex flex-col gap-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-800">Gemini API 設定與測試</h3>
                  <button onClick={() => setShowApiKeyInput(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={20} />
                  </button>
                </div>
                
                <p className="text-sm text-slate-500">
                  如果您無法使用本地 Ollama，請輸入您的「Gemini API 金鑰」以啟用雲端 AI 功能。
                  您可以從 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-emerald-600 underline">Google AI Studio</a> 獲取金鑰。
                </p>

                <div className="flex gap-4">
                  <input 
                    type="password" 
                    value={userApiKey}
                    onChange={(e) => {
                      setUserApiKey(e.target.value);
                      setKeyTestResult(null);
                    }}
                    placeholder="在此輸入 Gemini API Key..."
                    className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button 
                    onClick={handleTestKey}
                    disabled={isTestingKey || !userApiKey}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isTestingKey && <Loader2 size={16} className="animate-spin" />}
                    儲存並關閉
                  </button>
                </div>

                {keyTestResult === 'success' && (
                  <div className="text-sm text-emerald-600 font-medium flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    金鑰測試成功！Gemini 雲端 AI 已啟用。
                  </div>
                )}
                {keyTestResult === 'error' && (
                  <div className="text-sm text-red-500 font-medium flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    金鑰無效或連線失敗，請檢查您的金鑰。
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1">平均延遲</div>
                    <div className="text-xl font-bold text-emerald-600">
                      {apiMetrics.totalRequests > 0 ? Math.round(apiMetrics.totalLatencyMs / apiMetrics.totalRequests) : 0} ms
                    </div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1">成功率</div>
                    <div className="text-xl font-bold text-blue-600">
                      {apiMetrics.totalRequests > 0 ? Math.round((apiMetrics.successfulRequests / apiMetrics.totalRequests) * 100) : 100}%
                    </div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1">總請求</div>
                    <div className="text-xl font-bold text-slate-700">{apiMetrics.totalRequests}</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Guide Modal */}
        <AnimatePresence>
          {showGuideModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
              onClick={() => setShowGuideModal(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <AlertCircle className="text-emerald-600" />
                    使用指南
                  </h2>
                  <button 
                    onClick={() => setShowGuideModal(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div className="p-6 overflow-y-auto flex-1 text-slate-600 text-sm leading-relaxed space-y-6">
                  
                  <section>
                    <h3 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs">1</div>
                      什麼是 Ollama？
                    </h3>
                    <p className="mb-2">
                      Ollama 是一個可以讓你在「自己的電腦上」執行大型語言模型（例如 Llama 3, Mistral 等）的工具。
                      它的最大優點是「完全免費、保護隱私（資料不會上傳到雲端），且不需要網路連線」即可運作。
                    </p>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <p className="font-medium text-slate-700 mb-2">如何安裝與啟動 Ollama：</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>前往 <a href="https://ollama.com/" target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">Ollama 官方網站</a> 下載並安裝。</li>
                        <li>打開終端機 (Terminal) 或命令提示字元 (CMD)。</li>
                        <li>輸入指令下載模型：<code className="bg-slate-200 px-1.5 py-0.5 rounded text-emerald-700">ollama run llama3</code> (或你喜歡的模型)。</li>
                        <li>「重要」：為了讓此網頁能連線到 Ollama，你需要設定環境變數 <code className="bg-slate-200 px-1.5 py-0.5 rounded text-emerald-700">OLLAMA_ORIGINS="*"</code> 後再啟動 Ollama 服務。</li>
                      </ol>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs">2</div>
                      什麼是 Gemini API？
                    </h3>
                    <p className="mb-2">
                      Gemini 是 Google 開發的強大雲端 AI 模型。當你無法在本地執行 Ollama，或者需要更強大的推理能力（例如圖片辨識）時，可以使用 Gemini。
                    </p>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <p className="font-medium text-slate-700 mb-2">如何獲取 Gemini API Key：</p>
                      <ol className="list-decimal list-inside space-y-1 ml-2">
                        <li>前往 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a>。</li>
                        <li>登入你的 Google 帳號。</li>
                        <li>點擊 "Create API key" 按鈕。</li>
                        <li>複製產生的金鑰，並貼到本應用程式右上角的「配置金鑰」設定中。</li>
                      </ol>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs">3</div>
                      系統如何選擇 AI？
                    </h3>
                    <p>
                      本系統採用「智慧切換機制」：
                    </p>
                    <ul className="list-disc list-inside space-y-2 mt-2 ml-2">
                      <li>
                        <span className="font-medium text-slate-700">優先使用 Ollama：</span> 
                        系統會持續偵測本地端的 Ollama 服務 (預設 <code className="bg-slate-100 px-1 py-0.5 rounded">http://127.0.0.1:11434</code>)。如果偵測到 Ollama 正在運行，所有文字對話將優先透過 Ollama 處理，以確保您的隱私。
                      </li>
                      <li>
                        <span className="font-medium text-slate-700">自動切換 Gemini：</span>
                        如果 Ollama 未啟動，且您已設定了有效的 Gemini API Key，系統會自動將請求發送給 Gemini 處理。
                      </li>
                      <li>
                        <span className="font-medium text-slate-700">圖片辨識專屬：</span>
                        由於目前的本地模型配置，「藥物辨識」功能強制使用 Gemini 雲端 AI 進行圖片分析。請確保您已配置 Gemini API Key 以使用此功能。
                      </li>
                    </ul>
                  </section>

                </div>
                
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                  <button 
                    onClick={() => setShowGuideModal(false)}
                    className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors"
                  >
                    我了解了
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Disclaimer Modal */}
        <AnimatePresence>
          {showDisclaimerModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col"
              >
                <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-amber-50">
                  <AlertCircle className="text-amber-600" size={24} />
                  <h2 className="text-xl font-bold text-slate-800">醫療免責聲明</h2>
                </div>
                
                <div className="p-6 text-slate-600 text-sm leading-relaxed">
                  <p>
                    本系統由 AI 技術生成，分析結果僅供參考，不具備醫療診斷與處方權。若有任何身體不適，請務必諮詢專業醫療人員。
                  </p>
                </div>
                
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                  <button 
                    onClick={() => {
                      setShowDisclaimerModal(false);
                      localStorage.setItem('disclaimerAcceptedAt', Date.now().toString());
                    }}
                    className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors"
                  >
                    我同意並了解
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto h-full flex flex-col">
            <AnimatePresence mode="wait">
              {activeTab === 'chat' && (
                <motion.div 
                  key="chat"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex-1 flex flex-col gap-4"
                >
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-6">
                      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                        <MessageSquare size={40} />
                      </div>
                      <div className="max-w-md">
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">開始您的專業諮詢</h2>
                        <p className="text-slate-500">您可以點擊上方標籤上傳藥物照片，或直接在此輸入嬰幼兒的健康問題。</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                        <button onClick={() => setActiveTab('medication')} className="p-4 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 transition-all text-left group">
                          <Pill className="text-emerald-600 mb-2 group-hover:scale-110 transition-transform" />
                          <div className="font-semibold">辨識藥物風險</div>
                          <div className="text-xs text-slate-400">上傳藥袋或藥瓶照片</div>
                        </button>
                        <button onClick={() => setActiveTab('symptoms')} className="p-4 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 transition-all text-left group">
                          <AlertCircle className="text-amber-500 mb-2 group-hover:scale-110 transition-transform" />
                          <div className="font-semibold">症狀用藥建議</div>
                          <div className="text-xs text-slate-400">針對嬰兒症狀快速查詢</div>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 pb-24">
                      {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm relative ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}>
                            {msg.role === 'assistant' && (
                              <div className="flex justify-between items-start mb-2">
                                {speakingText === msg.content ? (
                                  <div className="flex items-end gap-0.5 h-4">
                                    <div className="wave-bar"></div>
                                    <div className="wave-bar"></div>
                                    <div className="wave-bar"></div>
                                    <div className="wave-bar"></div>
                                  </div>
                                ) : <div />}
                                <button 
                                  onClick={() => speak(msg.content)}
                                  className="p-1 text-slate-400 hover:text-emerald-600 transition-colors"
                                  title={speakingText === msg.content ? "停止播放" : "語音播放"}
                                >
                                  {speakingText === msg.content ? <Square size={14} fill="currentColor" /> : <Volume2 size={14} />}
                                </button>
                              </div>
                            )}
                            <div className="prose prose-slate max-w-none prose-sm">
                              {msg.content.split('\n').map((line, j) => (
                                <p key={j} className="mb-1">{line}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                      {isLoading && (
                        <div className="flex justify-start">
                          <div className="bg-white border border-slate-100 p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin text-emerald-600" />
                            <span className="text-sm text-slate-500">正在分析中...</span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'medication' && (
                <motion.div 
                  key="medication"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex-1 flex flex-col items-center justify-center"
                >
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
                    <div className="text-center mb-6">
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">藥物辨識與翻譯分析</h2>
                      <p className="text-slate-500">支援多國語言翻譯，請選擇拍照或上傳檔案。</p>
                    </div>

                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">翻譯目標語言</label>
                      <select 
                        value={targetLanguage}
                        onChange={(e) => setTargetLanguage(e.target.value)}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="繁體中文">繁體中文</option>
                        <option value="簡體中文">簡體中文</option>
                        <option value="English">English</option>
                        <option value="日本語">日本語</option>
                        <option value="Tiếng Việt">Tiếng Việt</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                      {medFiles.map(file => (
                        <div key={file.id} className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 group">
                          <img src={file.preview} alt="preview" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-xs font-medium truncate px-2">{file.name}</span>
                          </div>
                          <button 
                            onClick={() => removeFile(file.id)}
                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full shadow-md"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      
                      {medFiles.length < 4 && (
                        <>
                          <button 
                            onClick={startCamera}
                            className="aspect-video rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-400 hover:text-emerald-600"
                          >
                            <Camera size={32} />
                            <span className="text-sm font-medium">拍照辨識</span>
                          </button>
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-video rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-400 hover:text-emerald-600"
                          >
                            <Upload size={32} />
                            <span className="text-sm font-medium">上傳檔案</span>
                          </button>
                        </>
                      )}
                    </div>

                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept="image/*,application/pdf" 
                      multiple 
                      className="hidden" 
                    />

                    <button 
                      onClick={handleAnalyzeMedications}
                      disabled={medFiles.length === 0 || isLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                      {isLoading ? <Loader2 className="animate-spin" /> : <Upload size={20} />}
                      開始辨識與翻譯
                    </button>
                  </div>

                  {/* Camera Modal */}
                  {showCamera && (
                    <div className="fixed inset-0 bg-black z-50 flex flex-col">
                      <div className="flex-1 relative flex items-center justify-center">
                        <video ref={videoRef} autoPlay playsInline className="max-h-full max-w-full" />
                        <canvas ref={canvasRef} className="hidden" />
                      </div>
                      <div className="h-32 bg-slate-900 flex items-center justify-around px-8">
                        <button onClick={stopCamera} className="p-4 text-white hover:bg-white/10 rounded-full">
                          <X size={32} />
                        </button>
                        <button onClick={takePhoto} className="w-20 h-20 bg-white rounded-full border-4 border-slate-400 flex items-center justify-center">
                          <div className="w-16 h-16 bg-white rounded-full border-2 border-slate-900" />
                        </button>
                        <div className="w-12" /> {/* Spacer */}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'symptoms' && (
                <motion.div 
                  key="symptoms"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex-1 flex flex-col items-center"
                >
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100 mb-6">
                    <div className="text-center mb-8">
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">智慧醫療助理</h2>
                      <p className="text-slate-500">請描述您的症狀，AI 將為您提供建議，並建議您諮詢專業醫生。</p>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">症狀描述</label>
                        <textarea 
                          className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none resize-none"
                          placeholder="例如：頭痛、發燒、咳嗽等..."
                          id="symptomInput"
                        ></textarea>
                      </div>

                      <div className="flex gap-4">
                        <button 
                          onClick={() => setSymptomMode('concise')}
                          className={`flex-1 py-3 rounded-xl font-medium border transition-all ${symptomMode === 'concise' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
                        >
                          簡潔版建議
                        </button>
                        <button 
                          onClick={() => setSymptomMode('detailed')}
                          className={`flex-1 py-3 rounded-xl font-medium border transition-all ${symptomMode === 'detailed' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
                        >
                          詳細版建議
                        </button>
                      </div>

                      <button 
                        onClick={() => {
                          const val = (document.getElementById('symptomInput') as HTMLTextAreaElement).value;
                          handleSymptomSubmit(val);
                        }}
                        disabled={isLoading}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2"
                      >
                        {isLoading ? <Loader2 className="animate-spin" /> : <ChevronRight size={20} />}
                        獲取建議
                      </button>
                    </div>
                  </div>

                  {/* Inline Result Display */}
                  <AnimatePresence>
                    {symptomResult && (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-lg border border-emerald-100"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2 text-emerald-600">
                            <Stethoscope size={20} />
                            <h3 className="font-bold text-lg">專業建議結果</h3>
                          </div>
                          <div className="flex items-center gap-4">
                            {speakingText === symptomResult && (
                              <div className="flex items-end gap-0.5 h-4">
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                                <div className="wave-bar"></div>
                              </div>
                            )}
                            <button 
                              onClick={() => speak(symptomResult)}
                              className="p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition-all shadow-sm"
                              title={speakingText === symptomResult ? "停止播放" : "語音播放"}
                            >
                              {speakingText === symptomResult ? <Square size={18} fill="currentColor" /> : <Volume2 size={18} />}
                            </button>
                          </div>
                        </div>
                        <div className="prose prose-slate max-w-none">
                          {symptomResult.split('\n').map((line, i) => (
                            <p key={i} className="mb-2 text-slate-700">{line}</p>
                          ))}
                        </div>
                        <div className="mt-6 pt-6 border-t border-slate-100 flex justify-between items-center">
                          <span className="text-xs text-slate-400">此建議已同步儲存至對話紀錄</span>
                          <button 
                            onClick={() => setActiveTab('chat')}
                            className="text-emerald-600 text-sm font-semibold hover:underline"
                          >
                            前往對話詳談
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Input Bar (Only in Chat Tab) */}
        {activeTab === 'chat' && currentSessionId && (
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC] to-transparent">
            <div className="max-w-4xl mx-auto relative">
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="輸入您的問題..."
                className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-6 pr-28 shadow-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button 
                  onClick={startListening}
                  className={`p-2.5 rounded-xl transition-all shadow-md ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  title="語音輸入"
                >
                  <Mic size={20} />
                </button>
                <button 
                  onClick={handleSendMessage}
                  disabled={!inputText.trim() || isLoading}
                  className="p-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:bg-slate-300 transition-all shadow-md"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Rename Dialog */}
      <AnimatePresence>
        {isRenameDialogOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6">
                <h3 className="text-lg font-bold text-slate-900 mb-4">重新命名對話</h3>
                <input 
                  type="text" 
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="輸入新標題..."
                  autoFocus
                  onKeyPress={(e) => e.key === 'Enter' && handleRename()}
                />
              </div>
              <div className="flex border-t border-slate-100">
                <button 
                  onClick={() => setIsRenameDialogOpen(false)}
                  className="flex-1 py-4 text-slate-500 font-medium hover:bg-slate-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleRename}
                  className="flex-1 py-4 text-emerald-600 font-bold hover:bg-emerald-50 transition-colors border-l border-slate-100"
                >
                  確認
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
