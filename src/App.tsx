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
  BookOpen,
  Mic,
  MicOff,
  Volume2,
  VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session, Message, MedicationFile } from './types';
import { analyzeMedications, getSymptomAdvice, chatWithAI, generateTitleSummary } from './services/gemini';
import MarkdownRenderer from './components/MarkdownRenderer';
import { useSpeechRecognition, useSpeechSynthesis } from './hooks/useSpeech';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [medFiles, setMedFiles] = useState<MedicationFile[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'medication' | 'symptoms'>('chat');
  const [symptomMode, setSymptomMode] = useState<'concise' | 'detailed'>('concise');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [userApiKey, setUserApiKey] = useState(() => {
    return localStorage.getItem('nvidia_api_key') || (process.env.NVIDIA_API_KEY as string) || '';
  });
  const [isOllamaOnline, setIsOllamaOnline] = useState<boolean | null>(null);
  const [ollamaVersion, setOllamaVersion] = useState<string>('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [readmeContent, setReadmeContent] = useState('');
  const [nvidiaStatus, setNvidiaStatus] = useState<'idle' | 'valid' | 'invalid' | 'verifying'>(
    localStorage.getItem('nvidia_api_key') ? 'valid' : 'idle'
  );
  const [isVerifyingKey, setIsVerifyingKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(() => {
    return localStorage.getItem('has_accepted_disclaimer') === 'true';
  });
  // --- Voice features ---
  const { isListening, isSupported: speechInputSupported, startListening, stopListening } = useSpeechRecognition({
    onResult: (transcript) => setInputText(prev => prev + transcript)
  });
  const { speakingId, speak: speakText, stop: stopSpeech } = useSpeechSynthesis();

  const [apiMetrics, setApiMetrics] = useState<{ latency: number; successRate: number; totalRequests: number; successes: number }>({
    latency: 0,
    successRate: 100,
    totalRequests: 0,
    successes: 0
  });

  const updateMetrics = (latency: number, success: boolean) => {
    setApiMetrics(prev => {
      const newTotal = prev.totalRequests + 1;
      const newSuccesses = success ? prev.successes + 1 : prev.successes;
      return {
        latency: latency,
        totalRequests: newTotal,
        successes: newSuccesses,
        successRate: Math.round((newSuccesses / newTotal) * 100)
      };
    });
  };

  useEffect(() => {
    if (hasAcceptedDisclaimer) {
      localStorage.setItem('has_accepted_disclaimer', 'true');
    }
  }, [hasAcceptedDisclaimer]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions();
    checkOllamaStatus();
    if (userApiKey) verifyNvidiaKey(userApiKey);
    const interval = setInterval(() => {
      checkOllamaStatus();
      fetchSessions();
    }, 10000); 
    return () => clearInterval(interval);
  }, []);

  const verifyNvidiaKey = async (key: string) => {
    if (!key) {
      setNvidiaStatus('idle');
      return;
    }
    setIsVerifyingKey(true);
    setNvidiaStatus('verifying');
    setKeyError('');
    try {
      const res = await fetch('/api/ai/nvidia/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json();
      if (data.valid) {
        setNvidiaStatus('valid');
        localStorage.setItem('nvidia_api_key', key);
      } else {
        setNvidiaStatus('invalid');
        setKeyError(data.error || '金鑰無效');
      }
    } catch (e) {
      setNvidiaStatus('invalid');
      setKeyError('連線失敗');
    } finally {
      setIsVerifyingKey(false);
    }
  };

  const checkOllamaStatus = async () => {
    try {
      const res = await fetch('/api/ai/ollama/status');
      const data = await res.json();
      setIsOllamaOnline(data.status === 'online');
      if (data.version) setOllamaVersion(data.version);
    } catch (e) {
      setIsOllamaOnline(false);
    }
  };

  const fetchReadme = async () => {
    try {
      const res = await fetch('/api/readme');
      const data = await res.json();
      setReadmeContent(data.content);
      setShowReadme(true);
    } catch (e) {
      console.error("Failed to fetch README", e);
    }
  };

  useEffect(() => {
    if (currentSessionId) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

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
    if (!inputText.trim() || !currentSessionId) return;

    const userMsg: Message = { session_id: currentSessionId, role: 'user', content: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userMsg),
      });

      const startTime = Date.now();
      const aiResponse = await chatWithAI(
        messages.map(m => ({ role: m.role, content: m.content })), 
        inputText,
        userApiKey
      );
      const latency = Date.now() - startTime;
      updateMetrics(latency, !!aiResponse);

      const aiMsg: Message = { session_id: currentSessionId, role: 'assistant', content: aiResponse || '抱歉，我現在無法回答。' };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      setMessages(prev => [...prev, aiMsg]);

      // Auto-titling logic
      const currentSession = sessions.find(s => s.id === currentSessionId);
      if (currentSession && !currentSession.is_manual_title && messages.length === 0) {
        const generatedTitle = await generateTitleSummary(inputText, aiResponse || '', userApiKey);
        if (generatedTitle) {
          await fetch(`/api/sessions/${currentSessionId}`, {
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
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      if (medFiles.length >= 4) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        setMedFiles(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          preview: reader.result as string,
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
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
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setMedFiles(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          preview: dataUrl,
          name: `相機拍攝_${new Date().getTime()}.jpg`
        }]);
        stopCamera();
      }
    }
  };

  const handleAnalyzeMedications = async () => {
    if (medFiles.length === 0) return;
    setIsLoading(true);
    
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      const title = `藥物分析 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title }),
      });
      fetchSessions();
      setCurrentSessionId(sessionId);
    }

    try {
      const result = await analyzeMedications(medFiles.map(f => f.preview), targetLanguage, userApiKey);
      const aiMsg: Message = { 
        session_id: sessionId, 
        role: 'assistant', 
        content: `### 藥物分析與翻譯報告 (${targetLanguage})\n\n${result}` 
      };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      setMessages(prev => [...prev, aiMsg]);
      setActiveTab('chat');
      setMedFiles([]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSymptomSubmit = async (symptoms: string) => {
    if (!symptoms.trim()) return;
    setIsLoading(true);
    setSymptomResult(null);

    try {
      const result = await getSymptomAdvice(symptoms, symptomMode, userApiKey);
      setSymptomResult(result);
      
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = Date.now().toString();
        const title = `症狀諮詢 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
        await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, title }),
        });
        fetchSessions();
        setCurrentSessionId(sessionId);
      }

      const aiMsg: Message = { 
        session_id: sessionId, 
        role: 'assistant', 
        content: `### 症狀建議 (${symptomMode === 'concise' ? '簡潔' : '詳細'})\n\n${result}` 
      };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });
      setMessages(prev => [...prev, aiMsg]);

    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
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
              <div className="flex items-center gap-2 overflow-hidden flex-1">
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
                  <button onClick={(e) => togglePin(session, e)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-600"><Pin size={12} />{!!session.is_pinned ? '取消釘選' : '釘選至頂部'}</button>
                  <button onClick={(e) => openRenameDialog(session, e)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 text-slate-600"><Edit2 size={12} />重新命名</button>
                  <button onClick={(e) => deleteSession(session.id, e)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-red-50 text-red-600"><Trash2 size={12} />刪除對話</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 text-xs text-slate-400 text-center">智慧醫療助理 v1.0</div>

        <div className="p-4 border-t border-slate-100">
          <button onClick={fetchReadme} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-all font-medium group">
            <BookOpen size={20} className="group-hover:scale-110 transition-transform" />
            <span>使用指南</span>
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-30 shadow-sm relative">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"><History size={20} /></button>
            <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Stethoscope className="text-emerald-600" size={22} />智慧醫療助理</h1>
            
            <div className="flex items-center gap-3 ml-4">
              <div className="hidden md:flex items-center px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 text-[11px] font-bold">
                當前模式：{userApiKey && nvidiaStatus === 'valid' ? 'NVIDIA NIM 雲端加速' : '本地 Ollama 運作'}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-full border border-slate-200 cursor-help group/status relative">
                  <div className={`w-2 h-2 rounded-full ${isOllamaOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-slate-300'}`} />
                  <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">Ollama</span>
                  {isOllamaOnline && ollamaVersion && (
                    <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 px-3 py-1.5 bg-slate-900 text-white text-[11px] rounded-lg opacity-0 group-hover/status:opacity-100 pointer-events-none transition-all duration-200 scale-95 group-hover/status:scale-100 whitespace-nowrap z-[100] shadow-2xl">版本: {ollamaVersion}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-full border border-slate-200 relative group/nvidia">
                  <div className={`w-2 h-2 rounded-full ${nvidiaStatus === 'valid' ? 'bg-emerald-400 animate-breathe shadow-[0_0_8px_rgba(52,211,153,0.8)]' : nvidiaStatus === 'verifying' ? 'bg-amber-400 animate-pulse' : nvidiaStatus === 'invalid' ? 'bg-red-400' : 'bg-slate-300'}`} />
                  <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">NVIDIA</span>
                </div>
              </div>
              <button onClick={() => setShowApiKeyInput(!showApiKeyInput)} className="text-[10px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors border border-slate-200">配置金鑰</button>
            </div>
          </div>
          <nav className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setActiveTab('chat')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'chat' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>對話模式</button>
            <button onClick={() => setActiveTab('medication')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'medication' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>藥物辨識</button>
            <button onClick={() => setActiveTab('symptoms')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'symptoms' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>症狀諮詢</button>
          </nav>
        </header>

        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-center text-amber-700 text-xs font-medium z-10 shrink-0">
          <AlertCircle size={14} className="mr-2" />提示：本站為展示版本，對話紀錄將於伺服器重啟或閒置一段時間後自動清空。
        </div>

        <AnimatePresence>
          {showApiKeyInput && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="absolute top-16 left-0 right-0 bg-white border-b border-slate-200 p-4 z-20 shadow-lg">
              <div className="max-w-xl mx-auto flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-800">NVIDIA API 設定</h3>
                  <button onClick={() => setShowApiKeyInput(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input type="password" value={userApiKey} onChange={(e) => setUserApiKey(e.target.value)} placeholder="在此輸入 NVIDIA API Key..." className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                    <button onClick={() => { verifyNvidiaKey(userApiKey); setShowApiKeyInput(false); }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold">儲存並關閉</button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100"><div className="text-[10px] text-slate-400 uppercase font-bold mb-1">平均延遲</div><div className="text-lg font-mono font-bold text-emerald-600">{apiMetrics.latency} ms</div></div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100"><div className="text-[10px] text-slate-400 uppercase font-bold mb-1">成功率</div><div className="text-lg font-mono font-bold text-blue-600">{apiMetrics.successRate}%</div></div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100"><div className="text-[10px] text-slate-400 uppercase font-bold mb-1">總請求</div><div className="text-lg font-mono font-bold text-slate-600">{apiMetrics.totalRequests}</div></div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto h-full flex flex-col">
            <AnimatePresence mode="wait">
              {activeTab === 'chat' && (
                <motion.div key="chat" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex-1 flex flex-col gap-4">
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-6">
                      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600"><MessageSquare size={40} /></div>
                      <div className="max-w-md"><h2 className="text-2xl font-bold text-slate-900 mb-2">開始您的專業諮詢</h2><p className="text-slate-500">您可以上傳照片或輸入嬰幼兒健康問題。</p></div>
                    </div>
                  ) : (
                    <div className="space-y-6 pb-24">
                      {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                          {msg.role === 'assistant' && (
                            <button
                              onClick={() => speakingId === i ? stopSpeech() : speakText(msg.content.replace(/[#*`>\[\]]/g, ''), i)}
                              title={speakingId === i ? '停止朗讀' : '朗讀此訊息'}
                              className={`shrink-0 mb-1 p-1.5 rounded-full transition-all ${
                                speakingId === i
                                  ? 'bg-emerald-100 text-emerald-600 animate-pulse'
                                  : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'
                              }`}
                            >
                              {speakingId === i ? <VolumeX size={14} /> : <Volume2 size={14} />}
                            </button>
                          )}
                          <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}><MarkdownRenderer content={msg.content} /></div>
                        </div>
                      ))}
                      {isLoading && <div className="flex justify-start"><div className="bg-white border border-slate-100 p-4 rounded-2xl flex items-center gap-2"><Loader2 size={16} className="animate-spin text-emerald-600" /><span className="text-sm text-slate-500">正在分析中...</span></div></div>}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'medication' && (
                <motion.div key="medication" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex-1 flex flex-col items-center justify-center">
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
                    <h2 className="text-2xl font-bold text-center mb-6">藥物辨識與翻譯分析</h2>
                    <div className="grid grid-cols-2 gap-4 mb-8">
                      {medFiles.map(file => (
                        <div key={file.id} className="relative aspect-video rounded-xl overflow-hidden border border-slate-200">
                          <img src={file.preview} alt="preview" className="w-full h-full object-cover" />
                          <button onClick={() => removeFile(file.id)} className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"><X size={14} /></button>
                        </div>
                      ))}
                      {medFiles.length < 4 && (
                        <button onClick={startCamera} className="aspect-video rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600"><Camera size={32} /><span>拍照</span></button>
                      )}
                    </div>
                    <button onClick={handleAnalyzeMedications} disabled={medFiles.length === 0 || isLoading} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2">{isLoading ? <Loader2 className="animate-spin" /> : <Upload size={20} />}開始辨識</button>
                  </div>
                  {showCamera && (
                    <div className="fixed inset-0 bg-black z-50 flex flex-col">
                      <video ref={videoRef} autoPlay playsInline className="flex-1" />
                      <div className="h-24 bg-slate-900 flex items-center justify-around"><button onClick={stopCamera} className="text-white"><X size={32} /></button><button onClick={takePhoto} className="w-16 h-16 bg-white rounded-full" /></div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'symptoms' && (
                <motion.div key="symptoms" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex-1 flex flex-col items-center">
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100 mb-6">
                    <h2 className="text-2xl font-bold text-center mb-4">智慧醫療助理</h2>
                    <textarea className="w-full h-32 p-4 bg-slate-50 border rounded-2xl outline-none mb-4" placeholder="描述您的症狀..." id="symptomInput" />
                    <button onClick={() => { const val = (document.getElementById('symptomInput') as HTMLTextAreaElement).value; handleSymptomSubmit(val); }} disabled={isLoading} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2">{isLoading ? <Loader2 className="animate-spin" /> : <ChevronRight size={20} />}獲取建議</button>
                  </div>
                  {symptomResult && <div className="w-full max-w-2xl bg-white p-6 rounded-2xl shadow-lg border border-emerald-100"><MarkdownRenderer content={symptomResult} /></div>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {activeTab === 'chat' && currentSessionId && (
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F8FAFC] to-transparent">
            <div className="max-w-4xl mx-auto relative">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isListening ? '正在聆聽中，請說話...' : '輸入問題，或按麥克風說話...'}
                className={`w-full bg-white border rounded-2xl py-4 pl-6 shadow-lg outline-none transition-all ${
                  isListening ? 'border-red-400 ring-2 ring-red-200 pr-28' : 'border-slate-200 pr-24'
                }`}
              />
              {/* Mic button */}
              {speechInputSupported && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  title={isListening ? '停止錄音' : '語音輸入'}
                  className={`absolute right-14 top-1/2 -translate-y-1/2 p-2.5 rounded-xl transition-all ${
                    isListening
                      ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-200'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
              )}
              {/* Send button */}
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-emerald-600 text-white rounded-xl disabled:bg-slate-300 transition-colors"
              >
                <Send size={20} />
              </button>
            </div>
            {isListening && (
              <p className="text-center text-xs text-red-500 mt-2 animate-pulse font-medium">● 錄音中... 說完後請按麥克風停止</p>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {isRenameDialogOpen && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">重新命名對話</h3>
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full p-2 border rounded-lg mb-4" />
              <div className="flex gap-2"><button onClick={() => setIsRenameDialogOpen(false)} className="flex-1 py-2">取消</button><button onClick={handleRename} className="flex-1 py-2 bg-emerald-600 text-white rounded-xl">確認</button></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReadme && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setShowReadme(false)} className="absolute inset-0 bg-black/40" />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative bg-white w-full max-w-4xl max-h-[80vh] rounded-3xl overflow-hidden flex flex-col p-6">
              <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold">使用指南</h2><button onClick={() => setShowReadme(false)}><X /></button></div>
              <div className="flex-1 overflow-y-auto"><MarkdownRenderer content={readmeContent} /></div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!hasAcceptedDisclaimer && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-lg rounded-3xl p-8 text-center shadow-2xl">
              <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6"><AlertCircle size={32} /></div>
              <h2 className="text-2xl font-bold mb-4">醫療免責聲明</h2>
              <p className="text-sm text-slate-600 mb-8 text-left bg-slate-50 p-6 rounded-2xl">
                生成的建議僅供學術參考，不能替代專業醫師診斷。若有健康問題，請務必諮詢合格醫生。
              </p>
              <button onClick={() => setHasAcceptedDisclaimer(true)} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold">我已閱讀並同意</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
