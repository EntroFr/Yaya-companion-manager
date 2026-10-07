module.exports = {
  packagerConfig: {
    name: 'Yaya的陪玩日记', executableName: 'YayaDiary', asar: true,
    icon: require('node:path').join(__dirname, 'public/brand/app-icon.ico'),
    ignore: file => !!file && !/^\/(electron(?:\/|$)|\.electron-main(?:\/|$)|dist(?:\/|$)|node_modules(?:\/|$)|package\.json$)/.test(file.replaceAll('\\','/')),
  },
  makers: [{ name: '@electron-forge/maker-squirrel', config: { name: 'YayaDiary', setupExe: `YayaDiary-${require('./package.json').version}-Setup.exe`, setupIcon: require('node:path').join(__dirname, 'public/brand/app-icon.ico'), noMsi: true } }],
}
