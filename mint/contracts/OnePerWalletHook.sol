// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OnePerWalletHook — "one mint per wallet" for an ABX edition
/// @notice Wired as the edition's transfer hook (`abx set-param-hooks <token> --transfer <this>`).
///         The token calls `onTokenTransfer` on every mint, transfer and burn, and a revert here
///         fails that mint. This hook only ever looks at mints (`from == address(0)`):
///           - each wallet may mint at most MAX_PER_WALLET copies, counted over its lifetime,
///             so minting, sending the copy away and minting again doesn't work;
///           - the token's current owner is exempt (reserves, gifts);
///           - ordinary transfers and secondary sales are never blocked.
///         It limits wallets, not people: someone with several wallets can mint once from each.
contract OnePerWalletHook {
    error OnlyToken();
    error AlreadyMinted();

    uint256 public constant MAX_PER_WALLET = 1;

    /// The edition this hook serves. Calls from anywhere else are rejected.
    address public immutable token;

    /// Copies each wallet has minted (owner mints aren't counted).
    mapping(address => uint256) public minted;

    constructor(address token_) {
        token = token_;
    }

    function onTokenTransfer(uint256, address from, address to, address, uint256 amount) external {
        if (msg.sender != token) revert OnlyToken();
        if (from != address(0)) return; // transfer or burn: always allowed
        if (to == IOwnable(token).owner()) return; // owner mints are unlimited
        uint256 total = minted[to] + amount;
        if (total > MAX_PER_WALLET) revert AlreadyMinted();
        minted[to] = total;
    }

    /// How many more copies `wallet` may mint (for the mint page).
    function remaining(address wallet) external view returns (uint256) {
        if (wallet == IOwnable(token).owner()) return type(uint256).max;
        uint256 m = minted[wallet];
        return m >= MAX_PER_WALLET ? 0 : MAX_PER_WALLET - m;
    }
}

interface IOwnable {
    function owner() external view returns (address);
}
