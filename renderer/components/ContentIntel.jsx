/**
 * ContentIntel – Rich content intelligence panel.
 * Displays per-type enrichment data from /api/enrich:
 *   IMAGE  → EXIF, color palette, content category, technical info
 *   VIDEO  → title/channel, scene summary, frame timeline
 *   TEXT   → entities, sentiment, topic, writing stats
 *   AUDIO  → transcript, speaker info, quality summary
 */
import { useState } from 'react'
import {
  Cpu, Image, Video, Music, FileText, ChevronDown, ChevronUp,
  Camera, MapPin, Palette, BarChart2, Tag, Users, Globe,
  BookOpen, MessageSquare, Layers, Clock, Mic, Activity,
  AlertTriangle, CheckCircle, Info,
} from 'lucide-react'

/* ── Small helpers ─────────────────────────────────────────────────────────── */

function Section({ icon, title, children, accent = '#8b5cf6', defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{
      background: 'rgba(17,17,32,0.9)',
      border: `1px solid ${accent}22`,
      borderRadius: 6, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? `1px solid ${accent}18` : 'none',
        }}
      >
        <span style={{ color: accent, opacity: 0.8 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: accent, textTransform: 'uppercase', flex: 1, textAlign: 'left' }}>
          {title}
        </span>
        {open ? <ChevronUp size={11} style={{ color: '#475569' }} /> : <ChevronDown size={11} style={{ color: '#475569' }} />}
      </button>
      {open && <div style={{ padding: '12px 14px' }}>{children}</div>}
    </div>
  )
}

function KV({ label, value, mono, accent, full }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div style={{
      display: full ? 'block' : 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      paddingBottom: 6, borderBottom: '1px solid rgba(139,92,246,0.06)',
      gap: 8,
    }}>
      <span style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 11, color: accent || '#e2e8f0',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all', textAlign: 'right',
        marginTop: full ? 4 : 0,
      }}>{String(value)}</span>
    </div>
  )
}

function Badge({ text, color = '#8b5cf6', bg }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
      padding: '2px 8px', borderRadius: 3, marginRight: 5, marginBottom: 4,
      background: bg || `${color}18`,
      color,
      border: `1px solid ${color}44`,
      textTransform: 'uppercase',
    }}>
      {text}
    </span>
  )
}

/* ── Color swatch ─────────────────────────────────────────────────────────── */
function ColorPalette({ colors }) {
  if (!colors?.length) return <span style={{ fontSize: 10, color: '#475569' }}>No color data</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {colors.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 20, height: 20, borderRadius: 3,
            background: c.hex,
            border: '1px solid rgba(255,255,255,0.1)',
            flexShrink: 0,
          }} />
          <div>
            <div style={{ fontSize: 10, color: '#e2e8f0' }}>{c.name}</div>
            <div style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{c.hex} · {c.percentage}%</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Score bar ────────────────────────────────────────────────────────────── */
function ScoreBar({ label, value, max = 1, color }) {
  const pct = Math.min((value / max) * 100, 100)
  const c   = color || (pct > 70 ? '#f87171' : pct > 40 ? '#fbbf24' : '#34d399')
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#64748b' }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: c, fontFamily: 'monospace' }}>
          {typeof value === 'number' ? (max === 1 ? `${(value * 100).toFixed(0)}%` : value) : value}
        </span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${c},${c}99)`, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

/* ── Frame timeline row ───────────────────────────────────────────────────── */
function FrameTimeline({ timeline }) {
  if (!timeline?.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
      {timeline.map((f, i) => {
        const col = f.score >= 0.7 ? '#f87171' : f.score >= 0.4 ? '#fbbf24' : '#34d399'
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 8px', borderRadius: 3,
            background: `${col}08`,
            border: `1px solid ${col}22`,
          }}>
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#475569', minWidth: 36 }}>{f.timestamp}</span>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${f.score * 100}%`, background: col, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 9, color: col, minWidth: 36, textAlign: 'right', fontFamily: 'monospace' }}>
              {(f.score * 100).toFixed(0)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  IMAGE                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */
function ImageIntel({ data }) {
  if (!data) return null
  const { description, content_category, content_categories, exif, camera, location, dimensions, colors, technical } = data
  const bright = technical?.brightness_label
  const aiSw   = technical?.ai_software_in_exif

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Description */}
      {description && (
        <div style={{ padding: '10px 14px', background: 'rgba(139,92,246,0.04)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Content Description</div>
          <p style={{ margin: 0, fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>{description}</p>
        </div>
      )}

      {/* AI software warning */}
      {aiSw && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,170,0,0.08)', borderRadius: 5, border: '1px solid rgba(255,170,0,0.3)' }}>
          <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#fbbf24' }}>AI generation software detected in EXIF: <b>{aiSw}</b></span>
        </div>
      )}

      {/* Content categories */}
      {content_categories?.length > 0 && (
        <Section icon={<Tag size={12} />} title="Content Classification" accent="#8b5cf6">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {content_categories.map((c, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 4,
                background: i === 0 ? 'rgba(139,92,246,0.12)' : 'rgba(0,0,0,0.2)',
                border: `1px solid ${i === 0 ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.06)'}`,
              }}>
                <span style={{ fontSize: 11, color: i === 0 ? '#a78bfa' : '#64748b' }}>{c.label}</span>
                {c.score && (
                  <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>
                    {(c.score * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Technical details */}
        <Section icon={<Info size={12} />} title="Technical Info" accent="#8b5cf6">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <KV label="Dimensions"    value={dimensions?.width ? `${dimensions.width}×${dimensions.height}` : null} />
            <KV label="Megapixels"    value={dimensions?.megapixels ? `${dimensions.megapixels} MP` : null} />
            <KV label="Aspect Ratio"  value={dimensions?.aspect_ratio} />
            <KV label="Format"        value={dimensions?.format} />
            <KV label="Color Mode"    value={dimensions?.color_mode} />
            <KV label="File Size"     value={dimensions?.file_size_kb ? `${dimensions.file_size_kb} KB` : null} />
            <KV label="Brightness"    value={bright} />
          </div>
        </Section>

        {/* Camera / EXIF */}
        <Section icon={<Camera size={12} />} title="Camera & EXIF" accent="#8b5cf6">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {camera?.make || camera?.model ? (
              <>
                <KV label="Camera"    value={`${camera.make || ''} ${camera.model || ''}`.trim()} />
                <KV label="Captured"  value={camera.datetime} />
                <KV label="ISO"       value={camera.iso} />
                <KV label="Focal Len" value={camera.focal_length_mm ? `${camera.focal_length_mm}mm` : null} />
                <KV label="Exposure"  value={camera.exposure_seconds ? `${camera.exposure_seconds}s` : null} />
                {camera.software && <KV label="Software"  value={camera.software} />}
              </>
            ) : (
              <span style={{ fontSize: 10, color: '#475569' }}>
                {exif?.has_exif === false ? 'No EXIF data found' : 'No camera metadata'}
              </span>
            )}
            {exif?.datetime && !camera?.datetime && <KV label="Date/Time" value={exif.datetime} />}
          </div>
        </Section>
      </div>

      {/* Colors */}
      <Section icon={<Palette size={12} />} title="Color Palette" accent="#8b5cf6">
        <ColorPalette colors={colors} />
      </Section>

      {/* GPS */}
      {location && (
        <Section icon={<MapPin size={12} />} title="GPS Location" accent="#34d399">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <KV label="Latitude"  value={location.lat} mono />
            <KV label="Longitude" value={location.lon} mono />
          </div>
        </Section>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  VIDEO                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */
function VideoIntel({ data }) {
  if (!data) return null
  const {
    title, channel, description_snippet, duration_seconds, resolution, fps,
    view_count, upload_date, like_count, tags, platform, video_id,
    scene_summary, timeline, frame_stats, yt_dlp_note,
    transcript, transcript_note, transcript_lang, transcript_src,
    content_summary, summary_method, key_topics, summary_word_count,
  } = data

  const hasMetadata = title || channel || duration_seconds

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {yt_dlp_note && (
        <div style={{ padding: '8px 12px', background: 'rgba(255,170,0,0.06)', borderRadius: 4, border: '1px solid rgba(255,170,0,0.2)' }}>
          <span style={{ fontSize: 10, color: '#fbbf24' }}>{yt_dlp_note}</span>
        </div>
      )}

      {/* ── Content Summary ─────────────────────────────────────── */}
      {content_summary && (
        <div style={{
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(139,92,246,0.04))',
          border: '1px solid rgba(139,92,246,0.25)',
          borderRadius: 7,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Cpu size={12} style={{ color: '#a78bfa' }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#a78bfa', textTransform: 'uppercase' }}>
              Video Summary
            </span>
            {summary_method && (
              <span style={{ fontSize: 8, color: '#475569', marginLeft: 'auto' }}>{summary_method}</span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#e2e8f0', lineHeight: 1.8 }}>{content_summary}</p>
          {key_topics?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
                Key Topics
              </div>
              <div>{key_topics.map((t, i) => <Badge key={i} text={t} color="#8b5cf6" />)}</div>
            </div>
          )}
          {summary_word_count && (
            <div style={{ marginTop: 6, fontSize: 9, color: '#475569' }}>
              Transcript: {summary_word_count.toLocaleString()} words analyzed
            </div>
          )}
        </div>
      )}

      {/* Video metadata */}
      {hasMetadata && (
        <Section icon={<Video size={12} />} title="Video Info" accent="#8b5cf6">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {title && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Title</div>
                <p style={{ fontSize: 12, color: '#e2e8f0', margin: 0, lineHeight: 1.5 }}>{title}</p>
              </div>
            )}
            <KV label="Channel"    value={channel} />
            <KV label="Platform"   value={platform} />
            <KV label="Duration"   value={duration_seconds ? `${Math.floor(duration_seconds / 60)}m ${duration_seconds % 60 | 0}s` : null} />
            <KV label="Resolution" value={resolution} />
            <KV label="FPS"        value={fps} />
            <KV label="Views"      value={view_count != null ? view_count.toLocaleString() : null} />
            <KV label="Uploaded"   value={upload_date} />
            <KV label="Likes"      value={like_count != null ? like_count.toLocaleString() : null} />
            <KV label="Video ID"   value={video_id} mono />
          </div>
          {tags?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Tags</div>
              <div>{tags.map((t, i) => <Badge key={i} text={t} color="#8b5cf6" />)}</div>
            </div>
          )}
          {description_snippet && !content_summary && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Description</div>
              <p style={{ fontSize: 11, color: '#64748b', margin: 0, lineHeight: 1.6 }}>{description_snippet}</p>
            </div>
          )}
        </Section>
      )}

      {/* Full Transcript */}
      <Section icon={<FileText size={12} />} title="Transcript" accent="#8b5cf6" defaultOpen={false}>
        {transcript ? (
          <>
            {transcript_src && (
              <div style={{ fontSize: 9, color: '#475569', marginBottom: 6 }}>
                Source: {transcript_src}{transcript_lang ? ` · ${transcript_lang}` : ''}
              </div>
            )}
            <div style={{
              background: 'rgba(0,0,0,0.3)', borderRadius: 4,
              padding: '10px 12px', maxHeight: 260, overflowY: 'auto',
              border: '1px solid rgba(0,212,255,0.1)',
            }}>
              <p style={{ margin: 0, fontSize: 11, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{transcript}</p>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={13} style={{ color: '#475569', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#475569' }}>
              {transcript_note || 'No transcript available'}
            </span>
          </div>
        )}
      </Section>

      {/* Scene analysis */}
      {scene_summary && (
        <Section icon={<Activity size={12} />} title="Frame Analysis" accent="#8b5cf6">
          <p style={{ fontSize: 12, color: '#e2e8f0', margin: '0 0 10px', lineHeight: 1.6 }}>{scene_summary}</p>
          {frame_stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 10 }}>
              {[
                { label: 'HIGH RISK', value: frame_stats.high_risk,    color: '#f87171' },
                { label: 'MED RISK',  value: frame_stats.medium_risk,  color: '#fbbf24' },
                { label: 'CLEAN',     value: frame_stats.clean,        color: '#34d399' },
              ].map((s, i) => (
                <div key={i} style={{ padding: '8px 10px', borderRadius: 4, background: `${s.color}0a`, border: `1px solid ${s.color}22`, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: s.color, fontFamily: 'monospace' }}>{s.value ?? '—'}</div>
                  <div style={{ fontSize: 8, color: '#475569', letterSpacing: '0.1em', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
          {frame_stats && (
            <>
              <ScoreBar label="Mean AI Score" value={frame_stats.mean_score} color="#8b5cf6" />
              <ScoreBar label="Peak AI Score" value={frame_stats.max_score} />
            </>
          )}
        </Section>
      )}

      {/* Frame timeline */}
      {timeline?.length > 0 && (
        <Section icon={<Clock size={12} />} title="Frame Timeline" accent="#475569" defaultOpen={false}>
          <FrameTimeline timeline={timeline} />
        </Section>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  TEXT                                                                      */
/* ══════════════════════════════════════════════════════════════════════════ */
function TextIntel({ data }) {
  if (!data) return null
  const { entities, sentiment, topic, key_phrases, writing_stats, language_style, source_signals } = data

  const sentCol = sentiment?.score > 0.1 ? '#34d399' : sentiment?.score < -0.1 ? '#f87171' : '#64748b'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Topic */}
        {topic && (
          <Section icon={<Tag size={12} />} title="Topic" accent="#8b5cf6">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {topic.primary && (
                <Badge text={topic.primary} color="#a78bfa" />
              )}
              {topic.secondary && (
                <Badge text={topic.secondary} color="#8b5cf6" />
              )}
              {topic.scores && Object.entries(topic.scores).slice(0, 4).map(([t, s]) => (
                <ScoreBar key={t} label={t} value={s} max={Math.max(...Object.values(topic.scores))} color="#8b5cf6" />
              ))}
            </div>
          </Section>
        )}

        {/* Sentiment */}
        {sentiment && (
          <Section icon={<Activity size={12} />} title="Sentiment" accent={sentCol}>
            <div style={{ textAlign: 'center', padding: '6px 0 10px' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: sentCol, fontFamily: 'monospace' }}>
                {sentiment.label}
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                Score: {sentiment.score > 0 ? '+' : ''}{sentiment.score}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <KV label="Positive signals" value={sentiment.positive_signals} />
              <KV label="Negative signals" value={sentiment.negative_signals} />
              <KV label="Negations"        value={sentiment.negation_count} />
            </div>
          </Section>
        )}
      </div>

      {/* Named entities */}
      {entities && entities.total_found > 0 && (
        <Section icon={<Users size={12} />} title="Named Entities" accent="#8b5cf6">
          {entities.persons?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>People</div>
              <div>{entities.persons.map((p, i) => <Badge key={i} text={p} color="#8b5cf6" />)}</div>
            </div>
          )}
          {entities.organizations?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Organizations</div>
              <div>{entities.organizations.map((o, i) => <Badge key={i} text={o} color="#8b5cf6" />)}</div>
            </div>
          )}
          {entities.locations?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Locations</div>
              <div>{entities.locations.map((l, i) => <Badge key={i} text={l} color="#34d399" />)}</div>
            </div>
          )}
        </Section>
      )}

      {/* Key phrases */}
      {key_phrases?.length > 0 && (
        <Section icon={<MessageSquare size={12} />} title="Key Phrases" accent="#8b5cf6">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {key_phrases.map((p, i) => <Badge key={i} text={p} color="#8b5cf6" />)}
          </div>
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Writing stats */}
        {writing_stats && (
          <Section icon={<BookOpen size={12} />} title="Writing Stats" accent="#475569">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <KV label="Words"         value={writing_stats.word_count?.toLocaleString()} />
              <KV label="Sentences"     value={writing_stats.sentence_count} />
              <KV label="Avg Sent Len"  value={writing_stats.avg_sentence_length ? `${writing_stats.avg_sentence_length} words` : null} />
              <KV label="Vocab Diversity" value={writing_stats.vocab_diversity ? `${(writing_stats.vocab_diversity * 100).toFixed(0)}%` : null} />
              <KV label="Reading Level" value={writing_stats.reading_level} />
              <KV label="Read Time"     value={writing_stats.estimated_read_minutes ? `~${writing_stats.estimated_read_minutes} min` : null} />
            </div>
          </Section>
        )}

        {/* Language style + source */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {language_style && (
            <Section icon={<Layers size={12} />} title="Writing Style" accent="#475569">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <KV label="Formality"      value={language_style.formality} />
                <KV label="Passive Voice"  value={language_style.passive_voice_instances} />
                <KV label="Questions"      value={language_style.question_count} />
                <KV label="Hedging"        value={language_style.hedging_language_count} />
                <KV label="First Person"   value={language_style.uses_first_person ? 'Yes' : 'No'} />
              </div>
            </Section>
          )}
          {source_signals && (
            <Section icon={<Globe size={12} />} title="Source" accent="#475569">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <KV label="Domain"       value={source_signals.domain} mono />
                <KV label="Credibility"  value={source_signals.credibility}
                  accent={source_signals.credibility === 'Trusted' ? '#34d399' : source_signals.credibility === 'Questionable' ? '#fbbf24' : '#64748b'} />
                {source_signals.is_government  && <KV label="Government"  value="Yes" accent="#34d399" />}
                {source_signals.is_educational && <KV label="Educational" value="Yes" accent="#34d399" />}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  AUDIO                                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */
function AudioIntel({ data }) {
  if (!data) return null
  const { transcript, transcript_note, language, duration_label, content_type, quality_summary, speaker_estimate } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Overview */}
      <Section icon={<Mic size={12} />} title="Audio Overview" accent="#8b5cf6">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <KV label="Content Type"    value={content_type} />
          <KV label="Duration"        value={duration_label} />
          <KV label="Speaker(s)"      value={speaker_estimate} />
          <KV label="Language"        value={language} />
          <KV label="Voice Quality"   value={quality_summary} />
        </div>
      </Section>

      {/* Transcript */}
      <Section icon={<FileText size={12} />} title="Transcript" accent="#8b5cf6">
        {transcript ? (
          <div style={{
            background: 'rgba(0,0,0,0.3)', borderRadius: 4,
            padding: '10px 12px', maxHeight: 220, overflowY: 'auto',
            border: '1px solid rgba(0,212,255,0.1)',
          }}>
            <p style={{ margin: 0, fontSize: 12, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{transcript}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
            <Info size={13} style={{ color: '#475569', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#475569' }}>{transcript_note || 'Transcript unavailable'}</span>
          </div>
        )}
      </Section>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Main export                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */
const ENRICH_STEPS = {
  IMAGE: ['Fetching image data', 'Extracting EXIF metadata', 'Analyzing color palette', 'Generating caption', 'Building report'],
  VIDEO: ['Fetching video metadata', 'Retrieving transcript', 'Analyzing frame timeline', 'Summarizing content', 'Building report'],
  TEXT:  ['Parsing document', 'Extracting named entities', 'Analyzing sentiment & tone', 'Checking credibility signals', 'Building report'],
  AUDIO: ['Fetching audio metadata', 'Transcribing audio', 'Analyzing voice patterns', 'Detecting synthesis signals', 'Building report'],
}

export default function ContentIntel({ entity }) {
  const [state,   setState]   = useState('idle')   // idle | loading | done | error
  const [data,    setData]    = useState(null)
  const [errMsg,  setErrMsg]  = useState('')
  const [step,    setStep]    = useState(0)

  if (!entity) return null

  const mediaType = detectType(entity)
  const url       = entity.image_url || entity.source_url || entity.url ||
                    entity.audio_url || entity.video_url || ''

  const steps = ENRICH_STEPS[mediaType] || ENRICH_STEPS.IMAGE

  const typeIcon = {
    IMAGE: <Image  size={13} />,
    VIDEO: <Video  size={13} />,
    TEXT:  <FileText size={13} />,
    AUDIO: <Music  size={13} />,
  }[mediaType] || <Cpu size={13} />

  const runEnrich = async () => {
    if (!window.entityX?.enrichContent) {
      setErrMsg('enrichContent API not available')
      setState('error')
      return
    }
    setState('loading')
    setData(null)
    setErrMsg('')
    setStep(0)

    // Advance steps on timer (visual progress simulation)
    let currentStep = 0
    const maxStep = steps.length - 2  // leave last step for completion
    const tid = setInterval(() => {
      currentStep = Math.min(currentStep + 1, maxStep)
      setStep(currentStep)
      if (currentStep >= maxStep) clearInterval(tid)
    }, 1400)

    const params = { url }
    if (mediaType === 'TEXT') {
      params.text  = entity.text || entity.content || entity.ai_summary || ''
      params.title = entity.content_title || entity.title || ''
    }
    if (mediaType === 'VIDEO') {
      const raw = entity.frame_scores || entity.analysis?.frame_scores || []
      params.frame_scores    = Array.isArray(raw) ? raw : []
      params.frames_analysed = entity.frames_analysed || entity.analysis?.frames_analysed || 0
    }
    if (mediaType === 'AUDIO') {
      params.duration_seconds     = entity.duration_seconds || entity.analysis?.duration_seconds || 0
      params.forensic_explanation = entity.forensic_explanation || entity.analysis?.forensic_explanation || []
    }

    try {
      const result = await window.entityX.enrichContent(mediaType, params)
      clearInterval(tid)
      setStep(steps.length - 1)   // jump to last step briefly
      if (result?.error) {
        setErrMsg(result.error)
        setState('error')
      } else {
        setTimeout(() => { setData(result); setState('done') }, 300)
      }
    } catch (e) {
      clearInterval(tid)
      setErrMsg(e.message || 'Unknown error')
      setState('error')
    }
  }

  return (
    <div style={{ marginTop: 4 }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        background: 'rgba(17,17,32,0.9)',
        border: '1px solid rgba(139,92,246,0.2)',
        borderRadius: state === 'done' ? '6px 6px 0 0' : 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Cpu size={13} style={{ color: '#8b5cf6', filter: 'drop-shadow(0 0 4px #8b5cf6)' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#a78bfa', textTransform: 'uppercase' }}>
            Content Intelligence
          </span>
          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}>
            {mediaType}
          </span>
        </div>

        <div style={{ marginLeft: 'auto' }}>
          {state === 'idle' && (
            <button onClick={runEnrich} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 14px', borderRadius: 4, cursor: 'pointer',
              background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)',
              color: '#a78bfa', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            }}>
              {typeIcon}
              Deep Analysis
            </button>
          )}
          {state === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 12, height: 12, border: '2px solid rgba(139,92,246,0.2)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>
                  {steps[step]}…
                </span>
              </div>
              {/* Step dots */}
              <div style={{ display: 'flex', gap: 3 }}>
                {steps.map((_, i) => (
                  <div key={i} style={{
                    width: i <= step ? 10 : 6, height: 3, borderRadius: 2,
                    background: i <= step ? '#8b5cf6' : 'rgba(139,92,246,0.2)',
                    transition: 'all 0.3s ease',
                    boxShadow: i === step ? '0 0 6px #8b5cf6' : 'none',
                  }} />
                ))}
              </div>
            </div>
          )}
          {(state === 'done' || state === 'error') && (
            <button onClick={runEnrich} style={{
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              background: 'none', border: '1px solid rgba(139,92,246,0.18)',
              color: '#475569', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            }}>
              Re-analyze
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {state === 'error' && (
        <div style={{ padding: '10px 16px', background: 'rgba(255,45,85,0.06)', border: '1px solid rgba(255,45,85,0.2)', borderTop: 'none', borderRadius: '0 0 6px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <AlertTriangle size={12} style={{ color: '#f87171' }} />
            <span style={{ fontSize: 11, color: '#f87171' }}>Enrichment failed: {errMsg}</span>
          </div>
        </div>
      )}

      {/* Results */}
      {state === 'done' && data && (
        <div style={{
          padding: 14,
          background: 'rgba(4,15,35,0.7)',
          border: '1px solid rgba(139,92,246,0.15)',
          borderTop: 'none',
          borderRadius: '0 0 6px 6px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {mediaType === 'IMAGE' && <ImageIntel data={data} />}
          {mediaType === 'VIDEO' && <VideoIntel data={data} />}
          {mediaType === 'TEXT'  && <TextIntel  data={data} />}
          {mediaType === 'AUDIO' && <AudioIntel data={data} />}
        </div>
      )}
    </div>
  )
}

/* ── Utility ─────────────────────────────────────────────────────────────── */
function detectType(entity) {
  const t   = (entity?.type || entity?.entity_type || '').toUpperCase()
  const url = (entity?.image_url || entity?.source_url || entity?.url || '').toLowerCase()
  if (t === 'VIDEO' || t === 'AUDIO' || t === 'TEXT' || t === 'IMAGE') return t
  if (/\.(mp4|webm|mov|avi|mkv)/.test(url)) return 'VIDEO'
  if (/\.(mp3|wav|ogg|flac|aac|m4a)/.test(url)) return 'AUDIO'
  return 'IMAGE'
}
