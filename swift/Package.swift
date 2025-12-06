// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "JSONStructure",
    platforms: [
        .macOS(.v10_15),
        .iOS(.v13),
        .tvOS(.v13),
        .watchOS(.v6)
    ],
    products: [
        .library(
            name: "JSONStructure",
            targets: ["JSONStructure"]),
    ],
    targets: [
        .target(
            name: "JSONStructure",
            dependencies: []),
        .testTarget(
            name: "JSONStructureTests",
            dependencies: ["JSONStructure"]),
    ]
)
