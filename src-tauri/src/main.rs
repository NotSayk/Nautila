// Pas de console sous Windows en version publiée.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nautila_lib::run()
}
