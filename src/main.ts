import "./style.css";
import { mountApp } from "./ui/app";

const root = document.querySelector<HTMLDivElement>("#app")!;
mountApp(root);
