import { StyleSheet } from "react-native";
import { s, vs, fs } from "@/responsive";

export const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  scrollContent: { flexGrow: 1, justifyContent: "center" },
  content: { padding: s(24), maxWidth: s(400), width: "100%", alignSelf: "center" },
  title: { fontSize: fs(24), fontWeight: "700", marginBottom: vs(8), color: "#111" },
  subtitle: { fontSize: fs(15), color: "#666", marginBottom: vs(28) },

  /* Passkey quick-login */
  passkeyLoginButton: {
    backgroundColor: "#0a0a0a", borderRadius: s(12), paddingVertical: vs(16),
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: s(10), marginBottom: vs(4),
  },
  passkeyLoginText: { color: "#fff", fontSize: fs(16), fontWeight: "600" },

  /* Form */
  input: {
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd",
    borderRadius: s(12), paddingHorizontal: s(16), paddingVertical: vs(14),
    fontSize: fs(16), color: "#111", marginBottom: vs(12),
  },
  passwordContainer: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderWidth: 1, borderColor: "#ddd", borderRadius: s(12), marginBottom: vs(12),
  },
  passwordInput: { flex: 1, paddingHorizontal: s(16), paddingVertical: vs(14), fontSize: fs(16), color: "#111" },
  eyeButton: { paddingHorizontal: s(14), paddingVertical: vs(14), justifyContent: "center", alignItems: "center" },
  button: { backgroundColor: "#0a0a0a", borderRadius: s(12), paddingVertical: vs(16), alignItems: "center", marginTop: vs(8) },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontSize: fs(16), fontWeight: "600" },

  /* Dividers */
  dividerRow: { flexDirection: "row", alignItems: "center", marginTop: vs(20), marginBottom: vs(20) },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#ddd" },
  dividerText: { marginHorizontal: s(12), fontSize: fs(13), color: "#999", fontWeight: "500" },

  /* Create passkey button (shown when no passkey exists) */
  passkeySetupButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#ddd",
    borderRadius: s(12), paddingVertical: vs(14), gap: s(10),
  },
  passkeySetupText: { fontSize: fs(15), fontWeight: "600", color: "#0a0a0a" },
});
