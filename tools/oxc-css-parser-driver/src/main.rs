use std::{
    io::{self, Read},
    panic,
};

use oxc_css_parser::{Allocator, Parser, Syntax, ast::Stylesheet};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriverResult {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    recoverable_errors: usize,
}

fn main() {
    let syntax = parse_syntax();
    let mut source = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut source) {
        print_result(DriverResult {
            status: "crashed",
            message: Some(format!("failed to read stdin: {error}")),
            recoverable_errors: 0,
        });
        return;
    }

    let result = panic::catch_unwind(|| parse_source(&source, syntax)).unwrap_or_else(|payload| {
        DriverResult {
            status: "crashed",
            message: Some(match payload.downcast_ref::<&str>() {
                Some(message) => (*message).to_string(),
                None => match payload.downcast_ref::<String>() {
                    Some(message) => message.clone(),
                    None => "panic with non-string payload".to_string(),
                },
            }),
            recoverable_errors: 0,
        }
    });

    print_result(result);
}

fn parse_source(source: &str, syntax: Syntax) -> DriverResult {
    let allocator = Allocator::default();
    let mut parser = Parser::new(&allocator, source, syntax);
    match parser.parse::<Stylesheet>() {
        Ok(_) => {
            let recoverable_errors = parser.recoverable_errors();
            let first_recoverable_error = recoverable_errors
                .first()
                .map(|error| error.kind.to_string());
            DriverResult {
                status: if recoverable_errors.is_empty() {
                    "accepted"
                } else {
                    "accepted_with_errors"
                },
                message: first_recoverable_error,
                recoverable_errors: recoverable_errors.len(),
            }
        }
        Err(error) => DriverResult {
            status: "rejected",
            message: Some(error.kind.to_string()),
            recoverable_errors: parser.recoverable_errors().len(),
        },
    }
}

fn parse_syntax() -> Syntax {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--syntax" {
            return match args.next().as_deref() {
                Some("scss") => Syntax::Scss,
                Some("sass") => Syntax::Sass,
                Some("less") => Syntax::Less,
                _ => Syntax::Css,
            };
        }
    }
    Syntax::Css
}

fn print_result(result: DriverResult) {
    println!(
        "{}",
        serde_json::to_string(&result).expect("driver result should serialize")
    );
}
