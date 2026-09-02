const state = {
  status: null,
  session: null,
  rehearsal: false,
  active: false,
  paused: false,
  audioStream: null,
  recorder: null,
  analyser: null,
  monitorTimer: null,
  heardSpeech: false,
  lastVoiceAt: 0,
  startedAt: null,
  elapsedTimer: null,
  currentAudio: null,
};
const hostedDemo = !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

const $ = (selector) => document.querySelector(selector);
const setupView = $("#setup-view");
const callView = $("#call-view");
const briefForm = $("#brief-form");
const formError = $("#form-error");
const transcript = $("#transcript");

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.detail || body || `Request failed (${response.status})`);
  return body;
}

function showToast(message, duration = 3600) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, duration);
}

function renderStatus() {
  const status = state.status;
  if (!status) return;
  if (hostedDemo) {
    $("#system-strip").innerHTML = ["Public demo", "Typed rehearsal", "Browser voice"].map((label) =>
      `<span class="system-pill good">${escapeHtml(label)}</span>`
    ).join("");
    return;
  }
  const parts = [
    [status.stt && status.stt_warmed, "Local listening", status.stt ? "Listening warming…" : "Whisper missing"],
    [status.tts, "Kokoro voice", "Kokoro offline"],
    [status.brain_ready && status.brain_warmed, `${status.brain_provider} brain`, status.brain_ready ? "Brain warming…" : "Brain model missing"],
    [status.phone_app, "Phone ready", "Phone app missing"],
  ];
  $("#system-strip").innerHTML = parts.map(([ready, good, bad]) =>
    `<span class="system-pill ${ready ? "good" : "warn"}">${escapeHtml(ready ? good : bad)}</span>`
  ).join("");
}

function escapeHtml(value) {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");
  return span.innerHTML;
}

function briefPayload() {
  return {
    intention: $("#intention").value.trim(),
    contact_name: $("#contact-name").value.trim(),
    organization: $("#organization").value.trim(),
    phone_number: $("#phone-number").value.trim(),
    calling_on_behalf_of: $("#behalf").value.trim(),
    facts: $("#facts").value.trim(),
    boundaries: $("#boundaries").value.trim(),
    success_definition: $("#success").value.trim(),
    voice: state.status?.default_voice || "af_heart",
    speed: state.status?.default_speed || 1,
  };
}

async function prepareCall(rehearsal) {
  formError.hidden = true;
  if (!briefForm.reportValidity()) return;
  const submit = briefForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const brief = briefPayload();
    state.rehearsal = hostedDemo || rehearsal;
    if (hostedDemo) {
      const greeting = brief.contact_name ? `Hi ${brief.contact_name},` : "Hello,";
      state.session = {
        id: "public-demo",
        brief,
        status: "prepared",
        permission_granted: false,
        next_goal: "Ask permission to continue",
        transcript: [{
          role: "agent",
          text: `${greeting} I’m an automated assistant calling on behalf of ${brief.calling_on_behalf_of}. I use live transcription to follow the call. Is it okay if I continue?`,
          at: new Date().toISOString(),
        }],
      };
    } else {
      state.session = await api("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
    }
    enterCallView();
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

function enterCallView() {
  const brief = state.session.brief;
  state.active = false;
  state.paused = false;
  state.startedAt = null;
  window.clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
  $("#elapsed").textContent = "00:00";
  $("#start-button").disabled = false;
  $("#pause-button").disabled = false;
  $("#pause-button").hidden = false;
  $("#resume-button").hidden = true;
  $("#takeover-panel").hidden = true;
  setCallState("Ready when they answer", "waiting");
  setupView.hidden = true;
  callView.hidden = false;
  $("#mission-title").textContent = state.rehearsal ? "Rehearsal ready" : "Call prepared";
  $("#mission-intention").textContent = brief.intention;
  $("#mission-contact").textContent = state.rehearsal
    ? "Typed rehearsal"
    : [brief.contact_name, brief.organization].filter(Boolean).join(" · ") || brief.phone_number || "Phone contact";
  $("#mission-success").textContent = brief.success_definition || "Confirm the intention is complete";
  $("#mission-next").textContent = state.session.next_goal;
  $("#dial-button").hidden = state.rehearsal || !brief.phone_number;
  $("#start-button").textContent = state.rehearsal ? "Start voice rehearsal" : "Start AI after they answer";
  $("#export-link").href = `/api/sessions/${state.session.id}/transcript.txt`;
  if (hostedDemo) {
    $(".call-instructions strong").textContent = "Typed rehearsal only.";
    $(".call-instructions p").textContent = "This public demo uses browser voice and never accesses your microphone, phone, or local services.";
  }
  renderTranscript();
}

function renderTranscript() {
  transcript.innerHTML = "";
  for (const turn of state.session.transcript) appendTurn(turn);
}

function appendTurn(turn) {
  const wrapper = document.createElement("article");
  wrapper.className = `turn ${turn.role}`;
  const isAgent = turn.role === "agent";
  const time = turn.at ? new Date(turn.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now";
  wrapper.innerHTML = `
    <div class="turn-avatar">${isAgent ? "AI" : "THEM"}</div>
    <div class="turn-body">
      <div class="turn-label">${isAgent ? "Dialora" : "Other person"}</div>
      <p class="turn-text">${escapeHtml(turn.text)}</p>
      <span class="turn-time">${escapeHtml(time)}</span>
    </div>`;
  transcript.appendChild(wrapper);
  transcript.scrollTop = transcript.scrollHeight;
}

function setCallState(label, kind = "waiting") {
  $("#call-state").textContent = label;
  $("#call-dot").className = `call-dot ${kind}`;
  $("#audio-meter").classList.toggle("listening", kind === "live");
}

async function beginAgent() {
  if (state.active) return;
  if (!hostedDemo) {
    try {
      state.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      showToast("Microphone access is required. You can still use the typed rehearsal box.", 6000);
      state.audioStream = null;
    }
  }
  state.active = true;
  state.paused = false;
  state.startedAt = Date.now();
  startElapsed();
  $("#start-button").disabled = true;
  setCallState("Agent is introducing itself", "thinking");
  await speak(state.session.transcript[0].text);
  if (state.active && !state.paused && state.audioStream) startListening();
  else if (state.active) setCallState("Waiting for a typed reply", "waiting");
}

function startElapsed() {
  const update = () => {
    if (!state.startedAt) return;
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    $("#elapsed").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  update();
  state.elapsedTimer = window.setInterval(update, 1000);
}

async function speak(text) {
  stopListening(false);
  setCallState("Agent is speaking", "thinking");
  if (hostedDemo) {
    await new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = state.session.brief.speed || 1;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.speak(utterance);
    });
    return;
  }
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: state.session.brief.voice, speed: state.session.brief.speed }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Voice generation failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.currentAudio = audio;
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error("The generated audio could not play"));
      audio.play().catch(reject);
    });
    URL.revokeObjectURL(url);
    state.currentAudio = null;
  } catch (error) {
    showToast(error.message, 6000);
  }
}

function supportedMimeType() {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function startListening() {
  if (!state.active || state.paused || !state.audioStream || state.recorder?.state === "recording") return;
  const chunks = [];
  const mimeType = supportedMimeType();
  const recorder = new MediaRecorder(state.audioStream, mimeType ? { mimeType } : undefined);
  state.recorder = recorder;
  state.heardSpeech = false;
  state.lastVoiceAt = 0;
  const started = Date.now();

  const context = new AudioContext();
  const source = context.createMediaStreamSource(state.audioStream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  state.analyser = { context, node: analyser };
  const samples = new Uint8Array(analyser.fftSize);

  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = async () => {
    window.clearInterval(state.monitorTimer);
    state.monitorTimer = null;
    await context.close().catch(() => {});
    state.analyser = null;
    state.recorder = null;
    if (!state.heardSpeech || !chunks.length || !state.active || state.paused) return;
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    await transcribeAndRespond(blob, mimeType.includes("mp4") ? "mp4" : "webm");
  };
  recorder.start(250);
  setCallState("Listening", "live");

  state.monitorTimer = window.setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = Date.now();
    if (rms > 0.025) {
      state.heardSpeech = true;
      state.lastVoiceAt = now;
    }
    if (state.heardSpeech && now - state.lastVoiceAt > 1050) recorder.stop();
    else if (now - started > 24000) recorder.stop();
  }, 80);
}

function stopListening(discard = true) {
  window.clearInterval(state.monitorTimer);
  state.monitorTimer = null;
  if (discard) state.heardSpeech = false;
  if (state.recorder?.state === "recording") state.recorder.stop();
}

async function transcribeAndRespond(blob, extension) {
  setCallState("Transcribing locally", "thinking");
  try {
    const result = await api(`/api/sessions/${state.session.id}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Audio-Extension": extension },
      body: blob,
    });
    if (!result.text) {
      setCallState("I didn’t catch that", "waiting");
      window.setTimeout(startListening, 400);
      return;
    }
    await submitTurn(result.text);
  } catch (error) {
    showToast(error.message, 6000);
    pauseForTakeover("Local listening needs attention. Type what they said or take over the call.");
  }
}

async function submitTurn(text) {
  stopListening();
  appendTurn({ role: "recipient", text, at: new Date().toISOString() });
  setCallState("Choosing the next move", "thinking");
  try {
    let decision;
    if (hostedDemo) {
      state.session.transcript.push({ role: "recipient", text, at: new Date().toISOString() });
      decision = hostedDecision(text);
      if (decision.say) state.session.transcript.push({ role: "agent", text: decision.say, at: new Date().toISOString() });
    } else {
      const result = await api(`/api/sessions/${state.session.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      state.session = result.session;
      decision = result.decision;
    }
    $("#mission-next").textContent = decision.next_goal || "Continue naturally";
    if (decision.say) appendTurn({ role: "agent", text: decision.say, at: new Date().toISOString() });

    if (decision.status === "handoff") {
      pauseForTakeover(decision.reason || decision.next_goal || "A human decision is needed.");
      return;
    }
    if (decision.status === "success" || decision.status === "end") {
      if (decision.say) await speak(decision.say);
      endLocally(decision.status === "success" ? "Outcome reached" : "Conversation ended");
      return;
    }
    if (decision.say) await speak(decision.say);
    if (state.active && !state.paused && state.audioStream) startListening();
    else setCallState("Waiting for a typed reply", "waiting");
  } catch (error) {
    showToast(error.message, 7000);
    pauseForTakeover("The conversation brain needs attention. Speak directly while the agent is muted.");
  }
}

function hostedDecision(text) {
  const normalized = text.toLowerCase();
  if (/do not call|don't call|stop calling|remove me from/.test(normalized)) {
    return { say: "Understood. I’m sorry for the interruption, and I’ll end the call now.", status: "end", reason: "Do-not-call request", next_goal: "End the call" };
  }
  if (!state.session.permission_granted) {
    if (/^(no|nope|not okay)|don't consent|do not consent|don't transcribe|not comfortable/.test(normalized)) {
      return { say: "Of course. I’ll end the call now. Goodbye.", status: "end", reason: "Permission declined", next_goal: "End the call" };
    }
    if (/^(yes|yeah|yep|sure|okay|ok|fine|go ahead)|you may continue/.test(normalized)) {
      state.session.permission_granted = true;
      return {
        say: `Thank you. I’m calling because ${state.session.brief.intention.replace(/[.!?]+$/, "")}. Could you help with that?`,
        status: "continue",
        reason: "Permission granted",
        next_goal: state.session.brief.success_definition || "Clarify the requested outcome",
      };
    }
    return { say: "Before I continue, is it okay for an AI assistant using live transcription to handle this call?", status: "continue", reason: "Permission unclear", next_goal: "Get a clear yes or no" };
  }
  if (/password|passcode|one.?time code|card number|credit card|bank account|routing number|emergency|call 911|sign (a |the )?(contract|agreement)/.test(normalized)) {
    return { say: "I need to hand this part to Zuo. One moment, please.", status: "handoff", reason: "A human decision or private information is required", next_goal: "Human takeover required" };
  }
  if (/confirmed|booked|all set|scheduled|that works/.test(normalized)) {
    return { say: "Perfect, thank you for confirming. Goodbye.", status: "success", reason: "The requested outcome appears complete", next_goal: "End the call" };
  }
  return { say: "Thanks. What would be the next available option that fits those requirements?", status: "continue", reason: "Continue gathering options", next_goal: state.session.brief.success_definition || "Reach the requested outcome" };
}

function pauseForTakeover(guidance) {
  state.paused = true;
  stopListening();
  if (state.currentAudio) state.currentAudio.pause();
  $("#pause-button").hidden = true;
  $("#resume-button").hidden = false;
  $("#takeover-panel").hidden = false;
  $("#takeover-guidance").textContent = guidance;
  setCallState("You have the call", "waiting");
}

async function resumeAgent() {
  state.paused = false;
  $("#pause-button").hidden = false;
  $("#resume-button").hidden = true;
  $("#takeover-panel").hidden = true;
  if (!hostedDemo) {
    try { await api(`/api/sessions/${state.session.id}/resume`, { method: "POST" }); } catch (_) {}
  }
  if (state.audioStream) startListening();
  else setCallState("Waiting for a typed reply", "waiting");
}

function endLocally(label = "Session ended") {
  state.active = false;
  state.paused = false;
  stopListening();
  if (state.currentAudio) state.currentAudio.pause();
  window.clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
  state.audioStream?.getTracks().forEach((track) => track.stop());
  state.audioStream = null;
  setCallState(label, "ended");
  $("#start-button").disabled = true;
  $("#pause-button").disabled = true;
  $("#resume-button").hidden = true;
}

briefForm.addEventListener("submit", (event) => {
  event.preventDefault();
  prepareCall(false);
});

$("#rehearse-button").addEventListener("click", () => prepareCall(true));

$("#dial-button").addEventListener("click", () => {
  const number = state.session?.brief.phone_number;
  if (!number) return;
  window.location.href = `tel:${number.replace(/[^+\d]/g, "")}`;
  showToast("Phone opened. Return here and start the AI after the person answers.", 6000);
});

$("#start-button").addEventListener("click", beginAgent);
$("#pause-button").addEventListener("click", async () => {
  pauseForTakeover("Speak directly, then resume when you’re ready.");
  if (!hostedDemo) {
    try { await api(`/api/sessions/${state.session.id}/pause`, { method: "POST" }); } catch (_) {}
  }
});
$("#resume-button").addEventListener("click", resumeAgent);

$("#manual-turn-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#manual-turn");
  const text = input.value.trim();
  if (!text || !state.session) return;
  input.value = "";
  if (!state.active) {
    state.active = true;
    state.startedAt = Date.now();
    startElapsed();
    $("#start-button").disabled = true;
  }
  state.paused = false;
  $("#takeover-panel").hidden = true;
  await submitTurn(text);
});

$("#end-button").addEventListener("click", async () => {
  if (!state.session) return;
  if (!hostedDemo) {
    try { state.session = await api(`/api/sessions/${state.session.id}/end`, { method: "POST" }); } catch (_) {}
  }
  endLocally("Session ended — hang up in Phone");
});

$("#export-link").addEventListener("click", (event) => {
  if (!hostedDemo || !state.session) return;
  event.preventDefault();
  const lines = state.session.transcript.map((turn) => `${turn.role.toUpperCase()}: ${turn.text}`);
  const url = URL.createObjectURL(new Blob([lines.join("\n\n")], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "dialora-demo-transcript.txt";
  link.click();
  URL.revokeObjectURL(url);
});

$("#back-button").addEventListener("click", () => {
  endLocally();
  state.session = null;
  callView.hidden = true;
  setupView.hidden = false;
  $("#start-button").disabled = false;
  $("#pause-button").disabled = false;
  $("#pause-button").hidden = false;
  transcript.innerHTML = "";
});

window.addEventListener("beforeunload", () => {
  state.audioStream?.getTracks().forEach((track) => track.stop());
});

if (hostedDemo) {
  state.status = { default_voice: "browser", default_speed: 1 };
  renderStatus();
  $(".privacy-note p").innerHTML = "<strong>Private public demo.</strong> Rehearsal text stays in this browser tab and is not sent to a server. Run the local app for live calls.";
  $(".lede").textContent = "Try the call-planning and safety experience with typed replies. The public demo stays in this tab; the private local app handles real phone audio.";
  ["Set the outcome", "Type the replies", "Watch or take over"].forEach((label, index) => {
    $(".flow-card").querySelectorAll("p")[index].textContent = label;
  });
  briefForm.querySelector('button[type="submit"]').innerHTML = "Open demo <span>→</span>";
  $("#rehearse-button").hidden = true;
} else api("/api/status")
  .then(async (status) => {
    state.status = status;
    renderStatus();
    await api("/api/warmup", { method: "POST" });
    let checks = 0;
    const poll = window.setInterval(async () => {
      try {
        state.status = await api("/api/status");
        renderStatus();
        checks += 1;
        if ((state.status.stt_warmed && state.status.brain_warmed) || checks > 45) window.clearInterval(poll);
      } catch (_) {
        window.clearInterval(poll);
      }
    }, 1500);
  })
  .catch((error) => { $("#system-strip").innerHTML = `<span class="system-pill warn">${escapeHtml(error.message)}</span>`; });
