import { render } from "preact";
import { App } from "./app";
import "uplot/dist/uPlot.min.css";
import "./styles/global.css";

render(<App />, document.getElementById("app")!);
