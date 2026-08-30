export const metadata = {
  title: "Privacy Policy - AfroTune",
  description: "How AfroTune collects, uses, and stores your information.",
};

export default function PrivacyPolicyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 24, lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p style={{ opacity: 0.6, fontSize: 14 }}>Last updated: August 30, 2026</p>

      <p>
        AfroTune is a WhatsApp-first service: you describe the song you want in a WhatsApp
        conversation, and we turn it into a finished, personalized track. This policy explains
        what information we collect through that process, how we use it, and who we share it
        with.
      </p>

      <h2 style={{ marginTop: 32 }}>Information we collect</h2>
      <ul>
        <li>
          <strong>Your phone number.</strong> We use the WhatsApp number you message us from as
          your account identity - there is no separate signup or password.
        </li>
        <li>
          <strong>Your conversation with us.</strong> The messages you send while describing your
          song (genre, mood, occasion, lyrics ideas, language, and similar preferences), which we
          use to build your song brief.
        </li>
        <li>
          <strong>Payment records.</strong> When you buy credits, we store the payment status,
          amount, currency, and credit pack purchased. Card and payment details themselves are
          handled directly by Paystack, our payment processor - we do not receive or store your
          card number.
        </li>
        <li>
          <strong>Generated songs and related metadata.</strong> The songs we create for you,
          their generation status, and information like the rating you give a finished song.
        </li>
      </ul>

      <h2 style={{ marginTop: 32 }}>How we use this information</h2>
      <p>We use the information above to:</p>
      <ul>
        <li>operate the service and carry on your WhatsApp conversation;</li>
        <li>generate the songs you request;</li>
        <li>process payments for credits;</li>
        <li>provide customer support when you need help;</li>
        <li>prevent abuse of the service; and</li>
        <li>improve AfroTune over time.</li>
      </ul>

      <h2 style={{ marginTop: 32 }}>Third-party services we use</h2>
      <p>
        Parts of your information are shared with the following services, only as needed for them
        to do their job:
      </p>
      <ul>
        <li>
          <strong>Meta / WhatsApp Cloud API</strong> - the messaging platform your conversation
          with us happens on.
        </li>
        <li>
          <strong>OpenAI</strong> - processes your conversation to hold the dialogue and extract
          your song preferences.
        </li>
        <li>
          <strong>ElevenLabs</strong> - generates the actual music/audio for your song from the
          brief we build.
        </li>
        <li>
          <strong>Supabase</strong> - stores our application data (your account record,
          conversation state, songs, and payment records) and hosts generated song files.
        </li>
        <li>
          <strong>Paystack</strong> - processes payments when you buy credits.
        </li>
      </ul>
      <p>
        Each of these providers has its own privacy practices governing how it handles data on our
        behalf.
      </p>

      <h2 style={{ marginTop: 32 }}>Data retention and deletion</h2>
      <p>
        We keep your conversation history, song data, and payment records for as long as your
        account is active and as needed to provide the service, resolve support issues, and meet
        our own record-keeping needs. If you want your data deleted, contact us (see below) and
        we will delete or anonymize it, except where we need to keep payment records for legitimate
        accounting purposes.
      </p>

      <h2 style={{ marginTop: 32 }}>Your rights</h2>
      <p>
        You can ask us at any time to tell you what information we hold about your phone number,
        correct it, or delete it. To do so, contact us using the details below.
      </p>

      <h2 style={{ marginTop: 32 }}>Data security</h2>
      <p>
        We take reasonable measures to protect your information, including access controls on our
        systems and relying on our third-party providers' own security practices for the parts of
        the service they handle. No method of transmission or storage is completely secure, and we
        cannot guarantee absolute security.
      </p>

      <h2 style={{ marginTop: 32 }}>Changes to this policy</h2>
      <p>
        We may update this policy as AfroTune changes. We'll update the "Last updated" date above
        when we do.
      </p>

      <h2 style={{ marginTop: 32 }}>Contact us</h2>
      <p>
        Questions about this policy, or requests about your data, can be sent to{" "}
        <a href="mailto:abakwa2026@gmail.com" style={{ color: "#f5f5f5" }}>
          abakwa2026@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
