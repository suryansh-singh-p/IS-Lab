import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Video, User, Calendar, ChevronDown, ChevronRight } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

function getAuthHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function Admin() {
  const { token, user, logout } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await axios.get(`${API_URL}/admin/sessions`, {
          headers: getAuthHeaders(token)
        });
        if (!cancelled && res.data?.success && res.data?.data?.sessions) {
          setSessions(res.data.data.sessions);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || err.message || 'Failed to load sessions');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatDate = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    return date.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Video className="w-8 h-8 text-indigo-400" />
            Admin – Test results (session-wise)
          </h1>
          <div className="flex items-center gap-3">
            {user?.email && (
              <span className="text-slate-400 text-sm">{user.email}</span>
            )}
            <button
              onClick={logout}
              className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-sm hover:bg-white/20"
            >
              Sign out
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-slate-400 flex items-center gap-2">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Loading sessions…
          </div>
        )}
        {error && (
          <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200">
            {error}
          </div>
        )}
        {!loading && !error && sessions.length === 0 && (
          <p className="text-slate-400">No interview sessions yet.</p>
        )}
        {!loading && !error && sessions.length > 0 && (
          <div className="space-y-3">
            {sessions.map((session) => {
              const isExpanded = expandedId === session.id;
              const videos = session.videos || [];
              const completed = videos.filter((v) => v.evaluation_status === 'completed').length;
              return (
                <div
                  key={session.id}
                  className="rounded-xl bg-white/5 border border-white/10 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(session.id)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5"
                  >
                    <div className="flex items-center gap-4">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      )}
                      <div className="flex items-center gap-2 text-slate-300">
                        <User className="w-4 h-4" />
                        <span>{session.user_email}</span>
                      </div>
                      {session.candidate_name && (
                        <span className="text-slate-500">({session.candidate_name})</span>
                      )}
                      <span className="text-slate-500 text-sm flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {formatDate(session.created_at)}
                      </span>
                    </div>
                    <span className="text-slate-400 text-sm">
                      {videos.length} video(s) · {completed} evaluated
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-white/10 p-4 space-y-4">
                      {videos.map((v) => (
                        <div
                          key={v.id}
                          className="rounded-lg bg-white/5 p-4 text-sm"
                        >
                          <div className="font-medium text-slate-200 mb-2">
                            Q{v.question_id}: {v.question_text || '—'}
                          </div>
                          <div className="flex flex-wrap gap-2 text-slate-400 mb-2">
                            <span>Status: {v.evaluation_status}</span>
                            {v.score != null && (
                              <span className="text-indigo-300">Score: {v.score}</span>
                            )}
                          </div>
                          {v.file_path && token && (
                            <div className="mt-2 rounded-lg overflow-hidden bg-black/40">
                              <video
                                src={`${API_URL}/admin/video/${v.id}?token=${encodeURIComponent(token)}`}
                                controls
                                className="w-full max-h-64"
                                preload="metadata"
                              >
                                Your browser does not support the video tag.
                              </video>
                            </div>
                          )}
                          {v.answer_text && (
                            <p className="mt-2 text-slate-400 text-xs line-clamp-2">{v.answer_text}</p>
                          )}
                          {/* Evaluation criteria breakdown */}
                          {(() => {
                            const rawData = typeof v.evaluation_json === 'string' ? JSON.parse(v.evaluation_json) : v.evaluation_json;
                            const evalData = rawData?.evaluation;
                            if (!evalData || typeof evalData !== 'object') return null;
                            return (
                              <div className="mt-3 space-y-2">
                                <p className="text-xs font-semibold text-slate-300">Evaluation Breakdown:</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                  {['clarity', 'relevance', 'structure', 'examples', 'completeness', 'overall'].map((key) =>
                                    evalData[key] ? (
                                      <div key={key} className="p-2 rounded bg-white/5 border border-white/10">
                                        <span className="font-semibold text-indigo-300 capitalize">{key}:</span>{' '}
                                        <span className="text-slate-300">{evalData[key]}</span>
                                      </div>
                                    ) : null
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Admin;
