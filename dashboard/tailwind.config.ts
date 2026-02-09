import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        colosseum: {
          bg: "#0a0a0f",
          surface: "#1a1a2e",
          "surface-light": "#252540",
        },
        blood: {
          DEFAULT: "#dc2626",
          dark: "#991b1b",
          light: "#ef4444",
        },
        gold: {
          DEFAULT: "#f59e0b",
          dark: "#b45309",
          light: "#fbbf24",
        },
        accent: {
          DEFAULT: "#7c3aed",
          dark: "#5b21b6",
          light: "#a78bfa",
        },
      },
      fontFamily: {
        cinzel: ["var(--font-cinzel)", "Cinzel", "Trajan Pro", "serif"],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      keyframes: {
        /* Death: REKT text red glow throb */
        "rekt-glow": {
          "0%, 100%": {
            textShadow:
              "0 0 20px rgba(220,38,38,0.4), 0 0 40px rgba(220,38,38,0.2)",
            opacity: "0.7",
          },
          "50%": {
            textShadow:
              "0 0 30px rgba(220,38,38,0.7), 0 0 60px rgba(220,38,38,0.4)",
            opacity: "1",
          },
        },
        /* Attacker: pulsing red border glow */
        "attack-pulse": {
          "0%, 100%": {
            boxShadow:
              "0 0 8px rgba(220,38,38,0.3), inset 0 0 8px rgba(220,38,38,0.1)",
            borderColor: "rgba(220,38,38,0.6)",
          },
          "50%": {
            boxShadow:
              "0 0 20px rgba(220,38,38,0.6), inset 0 0 15px rgba(220,38,38,0.2)",
            borderColor: "rgba(220,38,38,1)",
          },
        },
        /* Target: quick white/red flash */
        "hit-flash": {
          "0%": { backgroundColor: "rgba(220,38,38,0.3)" },
          "50%": { backgroundColor: "rgba(255,255,255,0.15)" },
          "100%": { backgroundColor: "transparent" },
        },
        /* Defender: blue/purple shield shimmer */
        "shield-glow": {
          "0%, 100%": {
            boxShadow:
              "0 0 10px rgba(124,58,237,0.3), 0 0 20px rgba(124,58,237,0.1)",
            borderColor: "rgba(124,58,237,0.6)",
          },
          "50%": {
            boxShadow:
              "0 0 20px rgba(124,58,237,0.5), 0 0 40px rgba(124,58,237,0.2)",
            borderColor: "rgba(167,139,250,0.9)",
          },
        },
        /* Prediction correct: green border flash */
        "predict-correct": {
          "0%": {
            boxShadow: "0 0 0 rgba(34,197,94,0)",
            borderColor: "rgba(34,197,94,0.3)",
          },
          "30%": {
            boxShadow:
              "0 0 20px rgba(34,197,94,0.5), 0 0 40px rgba(34,197,94,0.2)",
            borderColor: "rgba(34,197,94,1)",
          },
          "100%": {
            boxShadow: "0 0 0 rgba(34,197,94,0)",
            borderColor: "rgba(34,197,94,0.3)",
          },
        },
        /* Prediction wrong: red border flash */
        "predict-wrong": {
          "0%": {
            boxShadow: "0 0 0 rgba(220,38,38,0)",
            borderColor: "rgba(220,38,38,0.3)",
          },
          "30%": {
            boxShadow:
              "0 0 20px rgba(220,38,38,0.5), 0 0 40px rgba(220,38,38,0.2)",
            borderColor: "rgba(220,38,38,1)",
          },
          "100%": {
            boxShadow: "0 0 0 rgba(220,38,38,0)",
            borderColor: "rgba(220,38,38,0.3)",
          },
        },
        /* Winner: gold glow pulse */
        "winner-glow": {
          "0%, 100%": {
            boxShadow:
              "0 0 15px rgba(245,158,11,0.3), 0 0 30px rgba(245,158,11,0.1)",
            borderColor: "rgba(245,158,11,0.6)",
          },
          "50%": {
            boxShadow:
              "0 0 30px rgba(245,158,11,0.6), 0 0 60px rgba(245,158,11,0.3), 0 0 90px rgba(245,158,11,0.1)",
            borderColor: "rgba(251,191,36,1)",
          },
        },
        /* Epoch countdown: urgent red throb */
        "countdown-urgent": {
          "0%, 100%": {
            textShadow:
              "0 0 10px rgba(220,38,38,0.5), 0 0 20px rgba(220,38,38,0.2)",
            transform: "scale(1)",
          },
          "50%": {
            textShadow:
              "0 0 20px rgba(220,38,38,0.8), 0 0 40px rgba(220,38,38,0.4)",
            transform: "scale(1.05)",
          },
        },
        /* Subtle entrance fade-in for new feed items */
        "feed-enter": {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        /* Sponsor parachute drop: gold glow slide-in */
        "sponsor-enter": {
          "0%": {
            opacity: "0",
            transform: "translateY(-12px) scale(0.95)",
            boxShadow: "0 0 0 rgba(245,158,11,0)",
          },
          "40%": {
            opacity: "1",
            transform: "translateY(0) scale(1)",
            boxShadow:
              "0 0 16px rgba(245,158,11,0.4), 0 0 32px rgba(245,158,11,0.15)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0) scale(1)",
            boxShadow: "0 0 0 rgba(245,158,11,0)",
          },
        },
        /* Price flash green (price went up) */
        "price-flash-up": {
          "0%": { backgroundColor: "rgba(34,197,94,0)" },
          "15%": { backgroundColor: "rgba(34,197,94,0.25)" },
          "100%": { backgroundColor: "rgba(34,197,94,0)" },
        },
        /* Price flash red (price went down) */
        "price-flash-down": {
          "0%": { backgroundColor: "rgba(220,38,38,0)" },
          "15%": { backgroundColor: "rgba(220,38,38,0.25)" },
          "100%": { backgroundColor: "rgba(220,38,38,0)" },
        },
        /* Burn counter flash: red/orange glow when new tokens are burned */
        "burn-flash": {
          "0%": {
            backgroundColor: "rgba(220,38,38,0)",
            boxShadow: "0 0 0 rgba(220,38,38,0)",
          },
          "20%": {
            backgroundColor: "rgba(220,38,38,0.2)",
            boxShadow:
              "0 0 12px rgba(220,38,38,0.4), 0 0 24px rgba(245,158,11,0.15)",
          },
          "100%": {
            backgroundColor: "rgba(220,38,38,0)",
            boxShadow: "0 0 0 rgba(220,38,38,0)",
          },
        },
      },
      animation: {
        "rekt-glow": "rekt-glow 2s ease-in-out infinite",
        "attack-pulse": "attack-pulse 0.6s ease-in-out infinite",
        "hit-flash": "hit-flash 0.4s ease-out forwards",
        "shield-glow": "shield-glow 2s ease-in-out infinite",
        "predict-correct": "predict-correct 1s ease-out forwards",
        "predict-wrong": "predict-wrong 1s ease-out forwards",
        "winner-glow": "winner-glow 1.5s ease-in-out infinite",
        "countdown-urgent": "countdown-urgent 1s ease-in-out infinite",
        "feed-enter": "feed-enter 0.3s ease-out forwards",
        "sponsor-enter": "sponsor-enter 0.6s ease-out forwards",
        "price-flash-up": "price-flash-up 0.8s ease-out forwards",
        "price-flash-down": "price-flash-down 0.8s ease-out forwards",
        "burn-flash": "burn-flash 1.2s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
