// --- Constants ---
const VOICES = {
  English: { Male: "Matthew", Female: "Alicia" },
  Hindi: { Male: "Aman", Female: "Namrita" },
  Tamil: { Male: "Murali", Female: "Iniya" },
  Telugu: { Male: "Zion", Female: "Josie" }
};

const LOCALES = {
  English: "en-US",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Telugu: "te-IN"
};


// --- State ---
const state = {
  place: '',
  image: '',
  length: 'Summary',
  voice: 'Male'
};

// --- DOM Elements ---
const cardsContainer = document.querySelector('.cards');
const experiencePanel = document.getElementById('experience');
const previewTitle = document.getElementById('previewTitle');
const audioSection = document.getElementById('audioSection');
const audioPlayer = document.getElementById('audioPlayer');
const transcriptText = document.getElementById('scriptText');
const generateButton = document.getElementById('generateBtn');
const languageSelect = document.getElementById('selectLanguage');
const closeButton = document.getElementById('closeExperience');
const searchPreviewCard = document.getElementById('searchPreviewCard');
const searchPreviewImage = document.getElementById('searchPreviewImage');
const searchPreviewTitle = document.getElementById('searchPreviewTitle');
const transcriptToggle = document.getElementById('transcriptToggle');
const transcriptContent = document.getElementById('transcriptContent');
const transcriptArrow = document.getElementById('transcriptArrow');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');

// --- Functions ---

function selectDestination(place, image, clickedCard = null) {
  state.place = place;
  state.image = image;

  // Update UI content
  previewTitle.textContent = place;
  cardsContainer.classList.add('faded');

  // Reset previous states
  document.querySelectorAll('.place-card').forEach(card => card.classList.remove('active'));
  searchPreviewCard.classList.add('hidden');

  // Handle Card Visibility
  if (clickedCard) {
    clickedCard.classList.add('active');
  } else {
    // If it's a search result, show the preview card
    searchPreviewImage.src = image;
    searchPreviewTitle.textContent = place;
    searchPreviewCard.classList.remove('hidden');
    searchPreviewCard.classList.add('active');
  }

  // Reset Audio Panel
  audioSection.classList.add('hidden');
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  transcriptText.textContent = '';
  transcriptContent.classList.add('hidden');
  generateButton.textContent = 'Generate Audio Guide';
  generateButton.disabled = false;

  // Show Panel with animation
  experiencePanel.classList.remove('hidden');
  setTimeout(() => {
    experiencePanel.classList.add('visible');
  }, 10);
}

function deselectDestination() {
  experiencePanel.classList.remove('visible');

  // Wait for animation to finish before hiding
  setTimeout(() => {
    experiencePanel.classList.add('hidden');
    cardsContainer.classList.remove('faded');
    searchPreviewCard.classList.add('hidden');
    document.querySelectorAll('.place-card').forEach(card => card.classList.remove('active'));
  }, 300);
}

// --- Event Listeners ---

// Close Button
closeButton.addEventListener('click', deselectDestination);

// Card Clicks
document.querySelectorAll('.place-card:not(.search-preview-card)').forEach(card => {
  card.addEventListener('click', () => {
    selectDestination(card.dataset.place, card.dataset.image, card);
  });
});

// Option Toggles (History Type)
const lengthButtons = document.querySelectorAll('[data-group="length"] button');
lengthButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    lengthButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.length = btn.dataset.value;
  });
});

// Option Toggles (Voice Gender)
const voiceButtons = document.querySelectorAll('[data-group="voice"] button');
voiceButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    voiceButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.voice = btn.dataset.value;
  });
});


// Generate Audio guide button Logic

// Use same-origin in production, localhost fallback for local dev
// (set window.BACKEND_URL to override, e.g. deployed API URL).
const GENERATE_AUDIO_GUIDE_API_URL = window.BACKEND_URL
  ? `${window.BACKEND_URL}/generate-audio-guide`
  : (window.location.protocol.startsWith('file')
    ? 'http://127.0.0.1:5000/generate-audio-guide'
    : '/generate-audio-guide');

generateButton.addEventListener('click', async () => {
  if (!state.place) {
    alert('Please select a destination first.');
    return;
  }
  generateButton.disabled = true;
  generateButton.textContent = '⏳ Generating Audio...';

  try {
    const selectedLanguage = languageSelect.value;
    const selectedVoice = state.voice;

    if (!VOICES[selectedLanguage] || !VOICES[selectedLanguage][selectedVoice]) {
      throw new Error(`No voice configured for ${selectedLanguage} / ${selectedVoice}`);
    }

    const response = await fetch(GENERATE_AUDIO_GUIDE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place: state.place,
        answerType: state.length,
        language: selectedLanguage,
        voiceId: VOICES[selectedLanguage][selectedVoice],
        locale: LOCALES[selectedLanguage]
      })
    });

    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error || ''; } catch (_) { /* non-JSON error */ }
      throw new Error(detail || 'Generation failed');
    }

    const data = await response.json();

    // Update UI with Result
    transcriptText.textContent = data.description || 'No description returned.';
    audioSection.classList.remove('hidden');

    if (data.audioBase64) {
      audioPlayer.src = `data:audio/mp3;base64,${data.audioBase64}`;
      audioPlayer.load();
      audioPlayer.classList.remove('hidden');
      generateButton.textContent = 'Regenerate Audio Guide';
    } else {
      audioPlayer.classList.add('hidden');
      generateButton.textContent = 'Audio Not Available';
    }
    generateButton.disabled = false;

  } catch (err) {
    console.error(err);
    alert(`Generation failed: ${err.message}. Please check your connection.`);
    generateButton.textContent = 'Generate Audio Guide';
    generateButton.disabled = false;
  }
});

// Search — was completely unwired (input + button did nothing).
function handleSearch() {
  const query = (searchInput.value || '').trim().toLowerCase();
  if (!query) {
    // Empty query: reset filter
    document.querySelectorAll('.place-card:not(.search-preview-card)').forEach(card => {
      card.style.display = '';
    });
    return;
  }

  const cards = [...document.querySelectorAll('.place-card:not(.search-preview-card)')];
  const match = cards.find(card =>
    (card.dataset.place || '').toLowerCase().includes(query)
  );

  if (match) {
    // Filter to the match and auto-select it
    cards.forEach(card => {
      card.style.display = card === match ? '' : 'none';
    });
    selectDestination(match.dataset.place, match.dataset.image, match);
    match.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    // No preset card matches: offer a generic search-result card
    // (uses a fallback image since we have no image for arbitrary places)
    cards.forEach(card => { card.style.display = 'none'; });
    const title = searchInput.value.trim();
    selectDestination(
      title,
      `https://source.unsplash.com/800x400/?${encodeURIComponent(title)},travel`
    );
  }
}

if (searchBtn) searchBtn.addEventListener('click', handleSearch);
if (searchInput) searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});

// Allow clicking the search-preview card (it was excluded from card handlers)
searchPreviewCard.addEventListener('click', () => {
  if (searchPreviewTitle.textContent) {
    selectDestination(
      searchPreviewTitle.textContent,
      searchPreviewImage.src,
      searchPreviewCard
    );
  }
});

// Transcript Toggle
transcriptToggle.addEventListener('click', () => {
  transcriptContent.classList.toggle('hidden');
  transcriptArrow.classList.toggle('rotate-180');
});
