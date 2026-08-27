// Do not open a console window alongside the application on Windows. FlowShark
// targets macOS, but the attribute is harmless and keeps the file conventional.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    flowshark_lib::run();
}
