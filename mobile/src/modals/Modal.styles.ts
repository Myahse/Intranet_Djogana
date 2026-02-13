import { StyleSheet } from "react-native";
import { s, vs } from "@/responsive";

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: "#fff",
    borderTopLeftRadius: s(20),
    borderTopRightRadius: s(20),
    width: "100%",
    overflow: "hidden",
  },
  handleRow: {
    alignItems: "center",
    paddingTop: vs(10),
    paddingBottom: vs(4),
  },
  handle: {
    width: s(36),
    height: vs(4),
    borderRadius: s(2),
    backgroundColor: "#ddd",
  },
});

export const touchableOverlayStyle = StyleSheet.absoluteFill;
