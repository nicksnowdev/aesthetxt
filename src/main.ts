/// <reference path="../node_modules/@types/p5/global.d.ts" />
import { getMatches } from '@tauri-apps/api/cli';
import { invoke } from '@tauri-apps/api';
import { ask } from '@tauri-apps/api/dialog';
import { appWindow, WebviewWindow } from '@tauri-apps/api/window';
import { exists, readTextFile, writeTextFile, removeFile, BaseDirectory } from '@tauri-apps/api/fs';
import p5 from 'p5';

// initial tauri app setup

// invoke a command to launch the sketch (ensures the window is ready)
invoke('ready', {}).then(() => {
  new p5(sketch);
});

// this variable keeps track of any launch arguments (open file with aesthetxt)
// if no argument is supplied, it defaults to 'false'
let openedWith: string;
getMatches().then((matches) => {
  // do something with the { args, subcommand } matches
  openedWith = <string>matches.args.source.value + '';
});

//
//
//
//
//
//
// end tauri setup
//
//
//
//
//
//

// the p5 application
const sketch = (p5: p5) => {
  // little p5 things
  p5.disableFriendlyErrors = true; // for speed
  // independent graphics objects for the window and the text itself in addition to the main canvas
  // this 3-layer architecture is baked into every theme.
  let textGraphics: p5.Graphics;
  let windowGraphics: p5.Graphics;
  // WebGL window sizing shenanigans
  let hw: number; // half width
  let hh: number; // half height
  let sf: number; // scale factor
  // for maintaining properly-scaled graphics
  const setAppRes = (r: number) => {
    p5.pixelDensity(r); // make the text look as crisp as possible;
    textGraphics.pixelDensity(r);
    windowGraphics.pixelDensity(r);
    sf = r; // used to set caret thickness
    p5.windowResized();
  };

  //
  //
  //
  //
  //
  //
  // text engine initialization
  //
  //
  //
  //
  //
  //

  // text engine variables

  let fontSize = 16;
  let lineH = fontSize * 1.25;
  let charW: number;
  let textMarginLeft = 32;
  let textMarginTop = 41.9 + fontSize;
  let caretLine = 0;
  let caretChar = 0;
  let mouseLine: number;
  let mouseChar: number;
  let caretVertChar: number; // this remembers the last caretChar while navigating vertically
  let caretVisible = document.hasFocus();
  let caretClock = 0; // for blinking the caret
  let mouseClock = 0; // for detecting multi clicks
  let scroll = 0; // actual scroll coordinate
  let scrollInterp = 0; // used to smooth scrolling when using a mouse wheel
  let editableLines: number;
  let scrollTicking = false; // used to throttle mouse wheel events
  let scrollDy: number; // scroll direction
  let selection = {
    active: false,
    begin: { ch: 0, ln: 0 },
    forward: true,
    wordEnd: 0,
    word: false,
    line: false,
  };
  // coordinates used in drawing selection
  let sx: number;
  let sy: number;
  let sw: number;
  // object to store states of modifier keys
  interface Imodifiers {
    Control: boolean;
    Meta: boolean;
    Shift: boolean;
    Mouse1: boolean;
    DubClick: boolean;
    TripClick: boolean;
  }
  const modifiers = {
    Control: false,
    Meta: false,
    Shift: false,
    Mouse1: false,
    DubClick: false,
    TripClick: false,
  };
  // mostly file stuff
  let lb: string; // line break characters
  let lbl: number; // number of line break characters
  let editorFont: p5.Font;
  let loadedText = ['']; // default new file content
  let loadedFileName = 'untitled.txt'; // default new file name
  let fileHandle: FileSystemFileHandle; // holds files opened with JS
  let saved = false; // keeps track of w/n there are unsaved changes
  let savedAs = false; // keeps track of w/n the current file exists on the hard drive
  let saveDirect = false; // keeps track of w/n the current file was opened directly and needs to be saved as such
  let directPath = ''; // keeps track of the path to a directly-opened file, if there is one
  let saveEffect = false; // this is set to true on saving / loading to trigger a visual effect
  // used in openFile and saveFile functions
  const openOpts = {
    types: [{ description: 'Plain text', accept: { 'text/plain': ['.txt'] } }],
    excludeAcceptAllOption: true,
    multiple: false,
  };
  const saveOpts = {
    types: [{ description: 'Plain text', accept: { 'text/plain': ['.txt'] } }],
    excludeAcceptAllOption: true,
    suggestedName: '',
  };
  // undo/redo command class and history array
  const commandHistory: any[] = [];
  let commandIndex = -1;
  class Command {
    func: Function;
    funcArgs: any;
    inverse: Function;
    inverseArgs: any;
    cLN: number; // caret line
    cCH: number; // caret character
    sbLN: number; // selection begin line
    sbCH: number; // selection begin character
    open: boolean; // is this command currently additive
    undoForward: boolean; // some commands move the caret backwards
    redoForward: boolean;
    constructor(
      func: Function,
      funcArgs: any,
      inverse: Function,
      inverseArgs: any,
      cLN: number,
      cCH: number,
      sbLN: number,
      sbCH: number,
      open: boolean,
      undoForward = true,
      redoForward = true
    ) {
      this.func = func;
      this.funcArgs = funcArgs;
      this.inverse = inverse;
      this.inverseArgs = inverseArgs;
      this.cLN = cLN;
      this.cCH = cCH;
      this.sbLN = sbLN;
      this.sbCH = sbCH;
      this.open = open;
      this.undoForward = undoForward;
      this.redoForward = redoForward;
    }
    undo() {
      if (this.undoForward) {
        selection.begin.ln = this.sbLN;
        selection.begin.ch = this.sbCH;
        caretLine = this.cLN;
        caretChar = this.cCH;
      } else {
        caretLine = this.sbLN;
        caretChar = this.sbCH;
        selection.begin.ln = this.cLN;
        selection.begin.ch = this.cCH;
      }
      selection.forward = this.undoForward;
      this.inverse(...this.inverseArgs);
    }
    redo() {
      if (this.redoForward) {
        selection.begin.ln = this.sbLN;
        selection.begin.ch = this.sbCH;
        caretLine = this.cLN;
        caretChar = this.cCH;
      } else {
        caretLine = this.sbLN;
        caretChar = this.sbCH;
        selection.begin.ln = this.cLN;
        selection.begin.ch = this.cCH;
      }
      selection.forward = this.redoForward;
      this.func(...this.funcArgs);
    }
  }

  // text engine functions

  // remove all undo entries ahead of the current index
  const clearFuture = () => {
    while (commandIndex < commandHistory.length - 1) {
      commandHistory.pop(); // remove
    }
  };
  // simple function for typing text anywhere in the document
  const typeText = (doc: string[], text: string, log = true) => {
    let lc = doc[caretLine]; // get line content
    let newLC: string;
    if (caretChar > 0 && caretChar < lc.length) {
      newLC = lc.slice(0, caretChar) + text + lc.slice(caretChar, lc.length);
    } else if (caretChar == 0) {
      newLC = text + lc;
    } else {
      newLC = lc + text;
    }
    doc[caretLine] = newLC; // update the data
    caretChar += text.length; // move the caret forward
    caretVertChar = caretChar;
    selection.begin.ln = caretLine;
    selection.begin.ch = caretChar;
    selection.active = false;
    caretVisible = true;
    caretClock = 0; // show caret
    autoscroll();
    if (log) {
      clearFuture(); // dump any redo history upon action
      // if there is a type command in progress
      if (
        commandHistory.length > 0 &&
        commandHistory[commandIndex].func == typeRange &&
        commandHistory[commandIndex].open
      ) {
        commandHistory[commandIndex].funcArgs[1] += text;
        commandHistory[commandIndex].cCH += text.length;
      } else {
        commandHistory.push(
          new Command(
            typeRange,
            [doc, text, false],
            deleteRange,
            [doc, false],
            caretLine,
            caretChar,
            selection.begin.ln,
            selection.begin.ch - text.length,
            true,
            true, // forward undo?
            false // forward redo?
          )
        );
        if (commandHistory.length <= 512) commandIndex++;
        else commandHistory.shift();
      }
    }
  };
  // functions to measure a multi-line string
  const textTopW = (t: string) => {
    let l = t.indexOf(lb);
    if (l == -1) {
      return t.length;
    } else {
      return l;
    }
  };
  const textBottomW = (t: string) => {
    let l = t.lastIndexOf(lb);
    if (l == -1) {
      return t.length;
    } else {
      return t.length - (l + lbl);
    }
  };
  const textH = (t: string) => {
    let l = (t.match(new RegExp(lb, 'g')) || []).length;
    return l; // THIS RETURNS THE NUMBER OF LINE BREAKS
  };
  // this types multiple lines of text at a time
  const typeRange = (doc: string[], text: string, log = true) => {
    let theText = text;
    if (theText == '') theText = lb; // this fixes the issue of undoing the deletion of a line break
    if (theText.indexOf(lb) == -1) {
      // single line
      typeText(doc, theText, false);
    } else {
      // multi line
      let textChunk = theText.split(lb);
      // type the first line
      typeText(doc, textChunk[0], false);
      // pre-position to type last line
      typeEnter(doc, false);
      caretLine += textChunk.length - 2;
      caretChar = 0;
      // splice the middle lines
      doc.splice(
        caretLine - (textChunk.length - 2),
        0,
        ...textChunk.splice(1, textChunk.length - 2)
      );
      // type the last line (which is now the second of only 2 lines stored in textChunk)
      typeText(doc, textChunk[1], false);
    }
    if (log) {
      clearFuture(); // dump any redo history upon action
      // if there is a type command in progress
      let w = textTopW(theText);
      let h = textH(theText);
      let multi: number;
      if (!h) multi = caretChar;
      else multi = doc[selection.begin.ln - h].length;
      commandHistory.push(
        new Command(
          typeRange,
          [doc, theText, false],
          deleteRange,
          [doc, false],
          caretLine,
          caretChar,
          selection.begin.ln - h,
          multi - w,
          false,
          true, // forward undo?
          false // forward redo?
        )
      );
      if (commandHistory.length <= 512) commandIndex++;
      else commandHistory.shift();
    }
  };
  // called by the paste event listener
  const paste = (doc: string[]) => {
    if (commandHistory.length > 0) commandHistory[commandIndex].open = false; // paste in a separate undo layer
    navigator.clipboard.readText().then((t) => {
      typeRange(doc, t);
    });
  };
  // self-explanatory name... i really don't know how this ended up over 70 lines long
  const deleteChar = (doc: string[], log = true) => {
    let lc = doc[caretLine];
    let newLC: string;
    let ch = doc[caretLine].charAt(caretChar - 1);
    let lineDeleteLN = 0; // these two vars handle logging this command in the history correctly
    let lineDeleteCH = 0;
    let topped = false;
    if (caretChar > 0 && caretChar < lc.length) {
      newLC = lc.slice(0, caretChar - 1) + lc.slice(caretChar, lc.length);
      doc[caretLine] = newLC; // update the data
      caretChar--; // move the caret backward
    } else if (caretChar == 0) {
      if (caretLine > 0) {
        caretLine--; // do this first to save a computation
        doc[caretLine] = doc[caretLine].concat(lc);
        caretChar = doc[caretLine].length - doc[caretLine + 1].length;
        doc.splice(caretLine + 1, 1); // remove the now duplicated line
        lineDeleteLN = 1;
        lineDeleteCH = caretChar + 1;
        ch = lb;
      } else {
        topped = true;
      }
    } else {
      newLC = lc.slice(0, caretChar - 1);
      doc[caretLine] = newLC; // update the data
      caretChar--; // move the caret backward
    }
    selection.begin.ln = caretLine;
    selection.begin.ch = caretChar;
    caretVertChar = caretChar;
    caretClock = 0; // show caret
    autoscroll();
    if (log) {
      // if not on the first character of the first line
      if (!topped) {
        clearFuture(); // dump any redo history upon action
        // if there is a type command in progress
        if (
          commandHistory.length > 0 &&
          commandHistory[commandIndex].func == deleteRange &&
          commandHistory[commandIndex].open
        ) {
          commandHistory[commandIndex].inverseArgs[1] =
            ch + commandHistory[commandIndex].inverseArgs[1];
          if (commandHistory[commandIndex].sbCH > 0) {
            commandHistory[commandIndex].sbCH--;
          } else {
            commandHistory[commandIndex].sbLN--;
            commandHistory[commandIndex].sbCH = doc[commandHistory[commandIndex].sbLN].length;
          }
        } else {
          commandHistory.push(
            new Command(
              deleteRange,
              [doc, false],
              typeRange,
              [doc, ch, false],
              caretLine + lineDeleteLN,
              caretChar + 1 - lineDeleteCH,
              selection.begin.ln,
              selection.begin.ch,
              true,
              false, // forward undo?
              true // forward redo?
            )
          );
          if (commandHistory.length <= 512) commandIndex++;
          else commandHistory.shift();
        }
      }
    }
  };
  const deleteRange = (doc: string[], log = true) => {
    let lc: string;
    let newLC: string;
    let deleteText = getRange(doc);
    // single line selection
    if (caretLine == selection.begin.ln) {
      lc = doc[caretLine];
      if (selection.forward) {
        newLC = lc.slice(0, selection.begin.ch) + lc.slice(caretChar, lc.length);
        caretChar = selection.begin.ch;
      } else {
        newLC = lc.slice(0, caretChar) + lc.slice(selection.begin.ch, lc.length);
      }
      doc[caretLine] = newLC;
    } else {
      // multi line selection begin
      if (selection.forward) {
        // first line
        lc = doc[selection.begin.ln];
        newLC = lc.slice(0, selection.begin.ch);
        doc[selection.begin.ln] = newLC;
        // last line
        lc = doc[caretLine];
        newLC = lc.slice(caretChar, lc.length);
        doc[selection.begin.ln] += newLC;
        // remove any middle lines
        doc.splice(selection.begin.ln + 1, caretLine - selection.begin.ln);
        caretChar = selection.begin.ch;
        caretLine = selection.begin.ln;
      } else {
        // first line
        lc = doc[caretLine];
        newLC = lc.slice(0, caretChar);
        doc[caretLine] = newLC;
        // last line
        lc = doc[selection.begin.ln];
        newLC = lc.slice(selection.begin.ch, lc.length);
        doc[caretLine] += newLC;
        // remove any middle lines
        doc.splice(caretLine + 1, selection.begin.ln - caretLine);
      }
    }
    selection.begin.ln = caretLine;
    selection.begin.ch = caretChar;
    autoscroll();
    if (log) {
      clearFuture(); // dump any redo history upon action
      // don't additively combine with a previous delete command
      if (commandHistory.length > 0) commandHistory[commandIndex].open = false;
      // if there is a type command in progress
      let w = textBottomW(deleteText);
      let h = textH(deleteText);
      let multi: number;
      if (!h) multi = caretChar;
      else multi = 0;
      commandHistory.push(
        new Command(
          deleteRange,
          [doc, false],
          typeRange,
          [doc, deleteText, false],
          caretLine + h,
          multi + w,
          selection.begin.ln,
          selection.begin.ch,
          false,
          false, // forward undo?
          true // forward redo?
        )
      );
      if (commandHistory.length <= 512) commandIndex++;
      else commandHistory.shift();
    }
  };
  // special function for adding lines to the array
  const typeEnter = (doc: string[], log = true) => {
    if (caretChar > 0 && caretChar < doc[caretLine].length) {
      doc.splice(caretLine + 1, 0, doc[caretLine].slice(caretChar));
      doc[caretLine] = doc[caretLine].slice(0, caretChar);
    } else if (caretChar == 0) {
      doc.splice(caretLine, 0, '');
    } else {
      doc.splice(caretLine + 1, 0, '');
    }
    caretLine++;
    caretChar = 0; // move the caret forward
    caretVertChar = caretChar;
    selection.begin.ln = caretLine;
    selection.begin.ch = caretChar;
    caretClock = 0; // show caret
    autoscroll();
    if (log) {
      clearFuture(); // dump any redo history upon action
      // if there is a type command in progress
      if (
        commandHistory.length > 0 &&
        commandHistory[commandIndex].func == typeRange &&
        commandHistory[commandIndex].open
      ) {
        commandHistory[commandIndex].funcArgs[1] += lb;
        commandHistory[commandIndex].cLN += 1;
        commandHistory[commandIndex].cCH = 0;
      } else {
        commandHistory.push(
          new Command(
            typeRange,
            [doc, lb, false],
            deleteRange,
            [doc, false],
            caretLine,
            caretChar,
            caretLine - 1,
            doc[caretLine - 1].length,
            true,
            true,
            false
          )
        );
        if (commandHistory.length <= 512) commandIndex++;
        else commandHistory.shift();
      }
    }
  };
  // this is used for copying selections, also a few other things.
  // it converts a section of text from the array into a single string
  const getRange = (doc: string[]) => {
    let theText = '';
    if (selection.begin.ln == caretLine) {
      if (selection.forward) {
        theText = doc[caretLine].slice(selection.begin.ch, caretChar);
      } else {
        theText = doc[caretLine].slice(caretChar, selection.begin.ch);
      }
    } else {
      if (selection.forward) {
        theText +=
          doc[selection.begin.ln].slice(selection.begin.ch, doc[selection.begin.ln].length) + lb;
        for (let i = selection.begin.ln + 1; i < caretLine; i++) {
          theText += doc[i] + lb;
        }
        theText += doc[caretLine].slice(0, caretChar);
      } else {
        theText += doc[caretLine].slice(caretChar, doc[caretLine].length) + lb;
        for (let i = caretLine + 1; i < selection.begin.ln; i++) {
          theText += doc[i] + lb;
        }
        theText += doc[selection.begin.ln].slice(0, selection.begin.ch);
      }
    }
    return theText;
  };
  // like get range but shortcutted to just grab the entire body of text
  const getDocString = (doc: string[]) => {
    let theText = '';
    for (let i = 0; i < doc.length - 1; i++) {
      theText += doc[i] + lb;
    }
    theText += doc[doc.length - 1];
    return theText;
  };
  // called by the copy event listener
  const copyRange = (doc: string[]) => {
    navigator.clipboard.writeText(getRange(doc));
  };
  // when stuff happens outside the current FoV, this automatically goes to it.
  const autoscroll = () => {
    while (caretLine - scroll < 0) {
      scroll--;
    }
    while (caretLine - scroll > editableLines) {
      scroll++;
    }
  };
  // this is it's own function because it needs to be called remotely while selecting outside the window
  const mouseMoved = (doc: string[]) => {
    // dubclick and tripclick imply a word or line selection is already active
    if (modifiers.DubClick) {
      caretLine = Math.min(
        Math.max(Math.floor((p5.mouseY - textMarginTop - fontSize * 0.25) / lineH + 1 + scroll), 0),
        doc.length - 1
      );
      caretChar = Math.min(
        Math.max(Math.floor((p5.mouseX + charW * 0.5 - textMarginLeft) / charW), 0),
        doc[caretLine].length
      );
      // check the direction, check if the caret is in the middle of the word and clamp it to the ends
      // check if direction has been reversed and we need to swap selection.begin.ch and selection.wordEnd
      if (selection.forward) {
        if (
          caretLine == selection.begin.ln &&
          caretChar >= selection.begin.ch &&
          caretChar < selection.wordEnd
        ) {
          caretChar = selection.wordEnd;
        } else if (
          (caretLine == selection.begin.ln && caretChar < selection.begin.ch) ||
          caretLine < selection.begin.ln
        ) {
          selection.forward = false;
          let temp = selection.begin.ch;
          selection.begin.ch = selection.wordEnd;
          selection.wordEnd = temp;
        }
      } else {
        if (
          caretLine == selection.begin.ln &&
          caretChar <= selection.begin.ch &&
          caretChar > selection.wordEnd
        ) {
          caretChar = selection.wordEnd;
        } else if (
          (caretLine == selection.begin.ln && caretChar > selection.begin.ch) ||
          caretLine > selection.begin.ln
        ) {
          selection.forward = true;
          let temp = selection.begin.ch;
          selection.begin.ch = selection.wordEnd;
          selection.wordEnd = temp;
        }
      }
    } else if (modifiers.TripClick) {
      caretLine = Math.min(
        Math.max(Math.floor((p5.mouseY - textMarginTop - fontSize * 0.25) / lineH + 1 + scroll), 0),
        doc.length - 1
      );
      selection.forward = caretLine >= selection.begin.ln;
      if (selection.forward) {
        selection.begin.ch = 0;
        caretChar = doc[caretLine].length;
      } else {
        selection.begin.ch = doc[selection.begin.ln].length;
        caretChar = 0;
      }
    } else {
      // single click behavior
      caretLine = Math.min(
        Math.max(Math.floor((p5.mouseY - textMarginTop - fontSize * 0.25) / lineH + 1 + scroll), 0),
        doc.length - 1
      );
      caretChar = Math.min(
        Math.max(Math.floor((p5.mouseX + charW * 0.5 - textMarginLeft) / charW), 0),
        doc[caretLine].length
      );

      if (caretLine != selection.begin.ln || caretChar != selection.begin.ch) {
        selection.active = true;
        caretVisible = false;
        selection.forward =
          caretLine > selection.begin.ln ||
          (caretLine == selection.begin.ln && caretChar > selection.begin.ch);
      } else {
        selection.active = false;
        caretVisible = true;
      }
    }
    caretVertChar = caretChar;
    // reset blink animation
    caretClock = 0;
  };

  // file i/o functions

  // until i start builoding for other platforms, this is barely used
  const osDetect = () => {
    let os = navigator.userAgent;
    let finalOs = '';
    if (os.search('Windows') !== -1) {
      finalOs = 'Windows';
    } else if (os.search('Mac') !== -1) {
      finalOs = 'MacOS';
    } else if (os.search('X11') !== -1 && !(os.search('Linux') !== -1)) {
      finalOs = 'UNIX';
    } else if (os.search('Linux') !== -1 && os.search('X11') !== -1) {
      finalOs = 'Linux';
    }
    return finalOs;
  };
  // make app visible once it's ready
  const showApp = () => {
    document.documentElement.style.setProperty('visibility', 'visible');
  };
  const openFile = (init = false, path = '') => {
    if (path != '') {
      showApp();
      const n = path.split(/\/|\\/);
      let nm = n[n.length - 1];
      readTextFile(path).then((t) => {
        loadedFileName = nm;
        loadedText = t.split(lb);
        caretLine = loadedText.length - 1;
        caretChar = loadedText[caretLine].length;
        saved = true;
        savedAs = true;
        saveDirect = true;
        directPath = path;
        appWindow.setTitle(loadedFileName + ' - aesthetxt');
        saveEffect = true; // not a save but i like this effect
      });
    } else {
      if (!savedAs && loadedText.length == 1 && loadedText[0] == '') {
        // open in this window
        window.showOpenFilePicker(openOpts).then(
          (fsfh) => {
            showApp();
            [fileHandle] = fsfh;
            fileHandle.getFile().then((f) => {
              loadedFileName = f.name;
              f.text().then((t) => {
                loadedText = t.split(lb);
                caretLine = loadedText.length - 1;
                caretChar = loadedText[caretLine].length;
                saved = true;
                savedAs = true;
                appWindow.setTitle(loadedFileName + ' - aesthetxt');
                saveFlash = saveFlashStr; // not a save but i like this effect
              });
            });
          },
          () => {
            // user cancels open
            if (init) {
              appWindow.close();
            }
          }
        );
      } else {
        writeTextFile('open.it', '', { dir: BaseDirectory.Temp }).then(() => {
          newFile();
        });
      }
    }
  };
  const saveFile = () => {
    if (saveDirect) {
      // if opened with a file, use a different save method
      writeTextFile(directPath, getDocString(loadedText));
      saved = true;
      saveEffect = true;
    } else {
      fileHandle.createWritable().then((w) => {
        w.write(getDocString(loadedText)).then(() => {
          w.close();
          saved = true;
          saveEffect = true;
        });
      });
    }
  };
  const saveFileAs = () => {
    window.showSaveFilePicker(saveOpts).then((fsfh) => {
      fileHandle = fsfh;
      fileHandle.createWritable().then((w) => {
        w.write(getDocString(loadedText)).then(() => {
          w.close();
          loadedFileName = fileHandle.name;
          saved = true;
          savedAs = true;
          appWindow.setTitle(loadedFileName + ' - aesthetxt');
          saveEffect = true;
        });
      });
    });
  };
  const newFile = (explicit = false) => {
    if (explicit) {
      // create this file in case the parent window was opened directly
      writeTextFile('new.file', '', { dir: BaseDirectory.Temp }).then(() => {
        new WebviewWindow(Date.now().toString(), {
          fullscreen: false,
          height: 600,
          minHeight: 160,
          minWidth: 160,
          resizable: true,
          title: 'untitled.txt - aesthetxt',
          width: 900,
          decorations: false,
          transparent: true,
        });
      });
    } else {
      new WebviewWindow(Date.now().toString(), {
        fullscreen: false,
        height: 600,
        minHeight: 160,
        minWidth: 160,
        resizable: true,
        title: 'untitled.txt - aesthetxt',
        width: 900,
        decorations: false,
        transparent: true,
      });
    }
  };
  // anything that would cause the window to close calls this function instead
  const confirmClose = () => {
    if (loadedText.length > 1 || loadedText[0] != '' || savedAs) {
      if (!saved) {
        ask('There are unsaved changes', {
          title: 'Wait!',
          type: 'warning',
          okLabel: 'Quit anyway',
          cancelLabel: 'Cancel',
        }).then((ok) => {
          if (ok) {
            appWindow.close();
          }
        });
      } else {
        appWindow.close();
      }
    } else {
      appWindow.close();
    }
  };

  //
  //
  // end text engine initialization
  //
  //
  //
  //
  //
  //
  //
  // Theme initialization
  //
  //

  // Theme-specific stuff

  enum Themes {
    dark_chroma,
  }
  let theme = Themes.dark_chroma; // default theme

  // dark chroma visuals
  let perlinChroma: p5.Shader; // shaders
  let perlinGlow: p5.Shader;
  let energy = 0; // energy level
  let energyClock = 0; // for energy animations
  let split = 1;
  let pageMargin = split * 2;
  let twist: number;
  let speed = 1; // THIS IS BASICALLY JUST A CONSTANT (use to adjust underlying animation speed)
  let cornerRadius = pageMargin * 3;
  let p1x: number; // layered window positioning stuff
  let p1y: number;
  let p2x: number;
  let p2y: number;
  let p3x: number;
  let p3y: number;
  let growthRate = 0.05;
  let typeClock = 0;
  let typeClockSmooth = 0;
  let typeDelay = 240;
  let decayRate = 0.02;
  let saveFlashStr = 100; // up to 150 has an effect on the current title bar color
  let saveFlash = saveFlashStr;
  // use this to scale the window effect, 0-3 works best
  const setEnergy = (level: number) => {
    energy = Math.min(Math.max(level, 0), 3);
    split = energy;
    twist = p5.atan((split * 2) / p5.max(p5.width, p5.height));
    pageMargin = split * 2;
    cornerRadius = pageMargin * 3;
  };

  //
  //
  // end theme initialization
  //
  //
  //
  //
  //
  //
  //
  // begin p5 core
  //
  //

  // p5 core

  // load shaders and fonts
  p5.preload = () => {
    // load shaders
    perlinChroma = p5.loadShader(
      '/shaders/perlin_chroma/vert.glsl',
      '/shaders/perlin_chroma/frag.glsl'
    );
    perlinGlow = p5.loadShader('/shaders/perlin_glow/vert.glsl', '/shaders/perlin_glow/frag.glsl');

    // load font
    editorFont = p5.loadFont('/fonts/FiraCode-Light.ttf');
  };

  // called whenever the window is resized
  p5.windowResized = () => {
    // keep hw and hh whole numbers
    let w = (p5.floor(p5.windowWidth * sf * 0.5) * 2) / sf;
    let h = (p5.floor(p5.windowHeight * sf * 0.5) * 2) / sf;

    // resize all graphics objects
    p5.resizeCanvas(w, h);
    textGraphics.resizeCanvas(w, h);
    windowGraphics.resizeCanvas(w, h);
    hw = p5.width * 0.5;
    hh = p5.height * 0.5;
    twist = p5.atan((split * 2) / p5.max(p5.width, p5.height)); // prevent twist from clipping on window boundaries
    editableLines = Math.floor((p5.height - textMarginTop - lineH * 0.5) / lineH);
  };

  // runs once at beginning
  p5.setup = () => {
    //
    //
    //
    //
    //
    //
    // begin p5 setup
    //
    //
    //
    //
    //
    //

    // create up graphics
    p5.createCanvas(1, 1, p5.WEBGL); // 3D mode to allow shaders
    textGraphics = p5.createGraphics(p5.width, p5.height, p5.WEBGL); // create a 3D graphics buffer
    windowGraphics = p5.createGraphics(p5.width, p5.height, p5.WEBGL); // create a 3D graphics buffer
    // configure graphics
    appWindow.scaleFactor().then((r) => {
      setAppRes(r);
    });
    p5.smooth();
    p5.setAttributes('depth', false); // make stuff actually draw at the expected depth in the expected order
    textGraphics.setAttributes('depth', false);
    p5.setAttributes('antialias', true);
    p5.setAttributes('premultipliedAlpha', false);
    textGraphics.setAttributes('premultipliedAlpha', false);
    windowGraphics.setAttributes('premultipliedAlpha', false);
    // finish configurations
    p5.angleMode(p5.DEGREES);
    textGraphics.angleMode(p5.DEGREES);
    windowGraphics.angleMode(p5.DEGREES);
    p5.background(0, 0); // initialize to 'clear'
    textGraphics.background(0, 0); // initialize to 'clear'
    windowGraphics.background(0, 0); // initialize to 'clear'
    // prepare font drawing
    textGraphics.textFont(editorFont);
    textGraphics.textSize(fontSize);
    textGraphics.noStroke();
    charW = textGraphics.textWidth(' ');
    // initialize energy
    setEnergy(0);

    // ensure the application renders at the expected resolution on differently scaled displays
    appWindow.listen('tauri://scale-change', () => {
      appWindow.scaleFactor().then((r) => {
        setAppRes(r);
      });
    });

    // determine style of line break
    if (osDetect() == 'Windows') {
      lb = '\r\n';
      lbl = 2;
    } else {
      lb = '\n';
      lbl = 1;
    }

    // add event listeners

    // custom context menu
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // everything else goes here
    });
    // title bar functions
    document
      .getElementById('titlebar-minimize')!
      .addEventListener('click', () => appWindow.minimize());
    document
      .getElementById('titlebar-maximize')!
      .addEventListener('click', () => appWindow.toggleMaximize());
    document.getElementById('titlebar-close')!.addEventListener('click', () => confirmClose());
    // blur / focus
    window.addEventListener('blur', () => {
      caretVisible = false;
    });
    window.addEventListener('focus', () => {
      caretVisible = true;
    });
    // mouse inputs
    document.getElementById('defaultCanvas0')!.addEventListener('mousedown', () => {
      // detect mouse click within margins
      if (
        p5.mouseX > pageMargin - 10 &&
        p5.mouseX < p5.width - pageMargin - 10 &&
        p5.mouseY < p5.height - pageMargin - 10 &&
        p5.mouseY > 32
      ) {
        setEnergy(energy + growthRate);
        typeClock = 0;
        if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1)
          commandHistory[commandIndex].open = false; // this action disrupts typing
        // double click selection business
        modifiers.Mouse1 = true;
        let lastCL = mouseLine;
        let lastCC = mouseChar;

        caretLine = Math.min(
          Math.max(
            Math.floor((p5.mouseY - textMarginTop - fontSize * 0.25) / lineH + 1 + scroll),
            0
          ),
          loadedText.length - 1
        );
        mouseLine = caretLine;
        caretChar = Math.min(
          Math.max(Math.floor((p5.mouseX + charW * 0.5 - textMarginLeft) / charW), 0),
          loadedText[caretLine].length
        );
        mouseChar = caretChar;

        // shift selection business (different behavior for standard, word, and line select modes)
        if (modifiers.Shift) {
          if (caretLine != selection.begin.ln || caretChar != selection.begin.ch) {
            selection.active = true;
            caretVisible = false;
            if (selection.word) {
              if (selection.forward) {
                if (
                  caretLine < selection.begin.ln ||
                  (caretLine == selection.begin.ln && caretChar < selection.begin.ch)
                ) {
                  let temp = selection.begin.ch;
                  selection.begin.ch = selection.wordEnd;
                  selection.wordEnd = temp;
                  selection.forward = false;
                }
              } else {
                if (
                  caretLine > selection.begin.ln ||
                  (caretLine == selection.begin.ln && caretChar > selection.begin.ch)
                ) {
                  let temp = selection.begin.ch;
                  selection.begin.ch = selection.wordEnd;
                  selection.wordEnd = temp;
                  selection.forward = true;
                }
              }
            } else if (selection.line) {
              modifiers.TripClick = true; // setting this to true here is a hacky way to make the drag selection code work right without changing it
              if (selection.forward) {
                selection.begin.ch = 0;
                caretChar = loadedText[caretLine].length;
                if (caretLine < selection.begin.ln) {
                  selection.forward = false;
                  selection.begin.ch = loadedText[selection.begin.ln].length;
                  caretChar = 0;
                }
              } else {
                selection.begin.ch = loadedText[selection.begin.ln].length;
                caretChar = 0;
                if (caretLine > selection.begin.ln) {
                  selection.forward = true;
                  selection.begin.ch = 0;
                  caretChar = loadedText[caretLine].length;
                }
              }
            } else {
              selection.forward =
                caretLine > selection.begin.ln ||
                (caretLine == selection.begin.ln && caretChar > selection.begin.ch);
            }
          } else {
            selection.active = false;
            caretVisible = true;
            selection.word = false;
            selection.line = false;
          }
        } else {
          // drag selection business
          selection.begin.ln = caretLine;
          selection.begin.ch = caretChar;

          // double click selection business
          // this might actually be the most incomprehensible garbage i've ever written
          //
          // explanation:
          //  clicking with the mouse saves a mouse version of caretLine and caretChar because the caret moves when a selection appears
          //  successfully double clicking causes word selection through the following quagmire of if/elses and for loops
          //  the double click modifier is reset upon failing the multiple click checker statement here
          //  successfully triple clicking causes double click to reset as well
          //  triple click always resets on release of the mouse button
          //
          //  the first two if statements inside the multi click checker is the really unreadable part. basically:
          //
          //  when you double click for the first time, the first IF statement sets dubclick to true.
          //  there will also be no active selection, which means both (1 required) conditions are met for word select in the second IF statement.
          //  if you quickly click again, the first IF statement turns off double click and enables triple click.
          //  however, there WILL BE AN ACTIVE SELECTION, which means neither conditions are met for word select and line select runs instead
          //  if you quickly click again after a triple click, there will still be an active selection, but the first IF statement re-enables double click, switching back to word select.
          //  from there, the cycle repeats.
          //
          //  this whole section is just me coping with the first solution i tried. I'm sure there is a better way than this.
          //  on the bright side, i can now use dubclick and tripclick to switch between behaviors in the onMouseMove event.
          if (mouseLine == lastCL && mouseChar == lastCC && mouseClock <= 30) {
            if (modifiers.DubClick) {
              modifiers.DubClick = false;
              modifiers.TripClick = true;
              selection.word = false;
              selection.line = true;
            } else {
              modifiers.DubClick = true;
            }
            if (!selection.active || modifiers.DubClick) {
              selection.active = true;
              selection.word = true;
              selection.line = false;
              caretVisible = false;
              selection.forward = true;
              selection.begin.ln = caretLine;
              let t = loadedText[caretLine];
              let c = t.charAt(caretChar);
              let cc = t.charCodeAt(caretChar);
              // if clicking in the middle of a word
              if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)) {
                selection.begin.ch = 0; // if the loop doesn't find non-alphanumeric to the left, select from beginning of line
                for (let i = caretChar; i >= 0; i--) {
                  // set selection.begin.ch to the index of the first non-alphanumeric working to the left
                  cc = t.charCodeAt(i);
                  if (cc < 48 || (cc > 57 && cc < 65) || (cc > 90 && cc < 97) || cc > 122) {
                    selection.begin.ch = i + 1;
                    break;
                  }
                }
                for (caretChar; caretChar < t.length; caretChar++) {
                  cc = t.charCodeAt(caretChar);
                  if (cc < 48 || (cc > 57 && cc < 65) || (cc > 90 && cc < 97) || cc > 122) {
                    break;
                  }
                }
              } else if (c == ' ') {
                // if selecting a whitespace region
                if (t.charAt(caretChar - 1) == ' ' || t.charAt(caretChar + 1) == ' ') {
                  selection.begin.ch = 0;
                  for (let i = caretChar; i > 0; i--) {
                    c = t.charAt(i);
                    if (c != ' ') {
                      selection.begin.ch = i + 1;
                      break;
                    }
                  }
                  for (caretChar; caretChar < t.length; caretChar++) {
                    c = t.charAt(caretChar);
                    if (c != ' ') {
                      break;
                    }
                  }
                } else {
                  // if selecting a single space, go left and determine region type
                  selection.begin.ch = 0;
                  cc = t.charCodeAt(caretChar - 1);
                  // if alphanumeric
                  if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)) {
                    selection.begin.ch = 0; // if the loop doesn't find non-alphanumeric to the left, select from beginning of line
                    for (let i = caretChar - 1; i >= 0; i--) {
                      // set selection.begin.ch to the index of the first non-alphanumeric working to the left
                      cc = t.charCodeAt(i);
                      if (cc < 48 || (cc > 57 && cc < 65) || (cc > 90 && cc < 97) || cc > 122) {
                        selection.begin.ch = i + 1;
                        break;
                      }
                    }
                  } else {
                    // if punctuation
                    selection.begin.ch = 0; // if the loop doesn't find non-alphanumeric to the left, select from beginning of line
                    for (let i = caretChar - 1; i >= 0; i--) {
                      // set selection.begin.ch to the index of the first non-alphanumeric working to the left
                      cc = t.charCodeAt(i);
                      if (
                        (cc >= 48 && cc <= 57) ||
                        (cc >= 65 && cc <= 90) ||
                        (cc >= 97 && cc <= 122) ||
                        cc == 32
                      ) {
                        selection.begin.ch = i + 1;
                        break;
                      }
                    }
                  }
                }
              } else if (c != '') {
                // if selecting a punctuation region
                selection.begin.ch = 0;
                for (let i = caretChar; i > 0; i--) {
                  cc = t.charCodeAt(i);
                  if (
                    (cc >= 48 && cc <= 57) ||
                    (cc >= 65 && cc <= 90) ||
                    (cc >= 97 && cc <= 122) ||
                    cc == 32
                  ) {
                    selection.begin.ch = i + 1;
                    break;
                  }
                }
                for (caretChar; caretChar < t.length; caretChar++) {
                  cc = t.charCodeAt(caretChar);
                  if (
                    (cc >= 48 && cc <= 57) ||
                    (cc >= 65 && cc <= 90) ||
                    (cc >= 97 && cc <= 122) ||
                    cc == 32
                  ) {
                    break;
                  }
                }
              } else {
                // if selecting the return at the end of a line
                selection.begin.ch = loadedText[caretLine].length;
                selection.wordEnd = selection.begin.ch;
                if (caretLine < loadedText.length - 1) {
                  // if not on last line of document
                  caretLine = selection.begin.ln + 1;
                  caretChar = 0;
                }
              }
              if (selection.wordEnd != selection.begin.ch) {
                // prevent this in the special case when word-selecting a line break
                selection.wordEnd = caretChar; // this is used for remembering the root of word selections
              }
              caretVertChar = caretChar;
            } else {
              // line select
              selection.begin.ch = 0;
              caretChar = loadedText[caretLine].length;
              caretVertChar = caretChar;
            }
          } else {
            selection.active = false;
            selection.word = false;
            selection.line = false;
            caretVisible = true;
            modifiers.DubClick = false;
          }
        }

        caretVertChar = caretChar;
        // reset blink animation
        caretClock = 0;
        mouseClock = 0;
        autoscroll();
      }
    });
    window.addEventListener('mouseup', () => {
      modifiers.Mouse1 = false;
      modifiers.TripClick = false;
    });
    window.addEventListener('mousemove', () => {
      // 'if clicking and dragging'
      if (modifiers.Mouse1) {
        mouseMoved(loadedText);
      }
    });
    document.addEventListener('wheel', (e) => {
      scrollDy = e.deltaY;
      if (!scrollTicking) {
        window.requestAnimationFrame(() => {
          // if likely a mouse wheel, scroll a 2 line interval and snap to grid
          if (Math.abs(scrollDy) >= 100) {
            scroll = Math.round(
              Math.min(Math.max(scroll + Math.sign(scrollDy) * 3, 0), loadedText.length - 1)
            );
          } else {
            scroll = Math.min(Math.max(scroll + scrollDy / 60, 0), loadedText.length - 1);
            scrollInterp = scroll;
          }
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    });
    // keyboard inputs
    document.addEventListener('keydown', (e) => {
      let deselect = false; // this keeps track of certain keys that should reset selection
      if (e.key.length == 1) {
        if (!modifiers.Control && !modifiers.Meta) {
          saved = false; // typing letters
          if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1) {
            if (commandHistory[commandIndex].func == deleteRange)
              commandHistory[commandIndex].open = false; // this action disrupts deleting
          }
          setEnergy(energy + growthRate);
          typeClock = 0;
          deselect = true;
          if (selection.active) {
            deleteRange(loadedText);
          }
          typeText(loadedText, e.key);
        } else {
          // ctrl shortcuts:
          switch (e.key) {
            case 'a':
              setEnergy(energy + growthRate);
              typeClock = 0;
              selection.active = true;
              selection.forward = true;
              caretVisible = false;
              caretLine = loadedText.length - 1;
              caretChar = loadedText[caretLine].length;
              caretVertChar = caretChar;
              selection.begin.ln = 0;
              selection.begin.ch = 0;
              break;
            case 'z':
              if (commandIndex > -1) {
                setEnergy(energy + growthRate);
                typeClock = 0;
                selection.active = false;
                caretVisible = true;
                caretClock = 0;
                commandHistory[commandIndex].open = false; // close the current command
                commandHistory[commandIndex].undo();
                commandIndex--;
              }
              break;
            case 'y':
            case 'Z': // lazy attempt at making mac shortcuts work
              if (commandIndex < commandHistory.length - 1) {
                setEnergy(energy + growthRate);
                typeClock = 0;
                selection.active = false;
                caretVisible = true;
                caretClock = 0;
                commandHistory[commandIndex + 1].redo();
                commandIndex++;
              }
              break;
            case 'n':
              modifiers.Control = false;
              modifiers.Meta = false;
              newFile(true); // call this explicitly when the user presses the button (not when it's called remotely from openFile)
              break;
            case 'o':
              modifiers.Control = false;
              modifiers.Meta = false;
              openFile();
              break;
            case 's':
              modifiers.Control = false;
              modifiers.Meta = false;
              if (savedAs) saveFile();
              else saveFileAs();
              break;
            case 'S':
              e.preventDefault();
              modifiers.Control = false;
              modifiers.Meta = false;
              modifiers.Shift = false;
              saveFileAs();
              break;
            case 'f':
              e.preventDefault();
              break;
            case 'g':
            case 'p':
            case 'P':
            case 'r':
            case 'u':
              e.preventDefault();
              break;
            case 'q':
            case 'w':
              e.preventDefault();
              confirmClose(); // prompt to save work
              break;
          }
        }
      } else {
        if (modifiers.hasOwnProperty(e.key)) {
          modifiers[e.key as keyof Imodifiers] = true;
        } else {
          switch (e.key) {
            case 'Backspace':
            case 'Delete':
              if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1) {
                if (commandHistory[commandIndex].func == typeRange)
                  commandHistory[commandIndex].open = false; // this action disrupts typing
              }
              // let backspace increase energy if something is actually being deleted
              if (!(caretLine == 0 && caretChar == 0)) {
                saved = false; // this effectively only triggers a change if you actually delete text
                setEnergy(energy + growthRate);
                typeClock = 0;
              }
              deselect = true;
              if (selection.active) {
                deleteRange(loadedText);
              } else {
                deleteChar(loadedText);
              }
              break;
            case 'Enter':
              saved = false;
              setEnergy(energy + growthRate);
              typeClock = 0;
              deselect = true;
              if (selection.active) {
                deleteRange(loadedText);
              }
              typeEnter(loadedText);
              break;
            case 'Tab':
              saved = false;
              setEnergy(energy + growthRate);
              typeClock = 0;
              e.preventDefault(); // prevent tabbing out
              typeText(loadedText, '    '); // use 4 spaces instead of tabs. it's just easier.
              break;
            case 'ArrowLeft':
              if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1)
                commandHistory[commandIndex].open = false; // this action disrupts typing
              // move caret unless you are resetting a selection
              if (!(!modifiers.Shift && selection.active)) {
                if (caretChar > 0) {
                  setEnergy(energy + growthRate);
                  typeClock = 0;
                  caretChar--;
                } else if (caretLine > 0) {
                  setEnergy(energy + growthRate);
                  typeClock = 0;
                  caretLine--;
                  caretChar = loadedText[caretLine].length;
                }
              } else {
                setEnergy(energy + growthRate);
                typeClock = 0;
              }
              autoscroll();
              caretVertChar = caretChar;
              // select with shift
              if (modifiers.Shift) {
                if (caretLine != selection.begin.ln || caretChar != selection.begin.ch) {
                  selection.active = true;
                  caretVisible = false;
                  selection.forward =
                    caretLine > selection.begin.ln ||
                    (caretLine == selection.begin.ln && caretChar > selection.begin.ch);
                } else {
                  selection.active = false;
                  caretVisible = true;
                  caretClock = 0;
                }
              } else {
                deselect = true;
                if (selection.active) {
                  if (selection.forward) {
                    caretChar = selection.begin.ch;
                    caretLine = selection.begin.ln;
                  }
                }
              }
              break;
            case 'ArrowRight':
              if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1)
                commandHistory[commandIndex].open = false; // this action disrupts typing
              // move caret unless you are resetting a selection
              if (!(!modifiers.Shift && selection.active)) {
                if (caretChar < loadedText[caretLine].length) {
                  setEnergy(energy + growthRate);
                  typeClock = 0;
                  caretChar++;
                } else if (caretLine < loadedText.length - 1) {
                  setEnergy(energy + growthRate);
                  typeClock = 0;
                  caretLine++;
                  caretChar = 0;
                }
              } else {
                setEnergy(energy + growthRate);
                typeClock = 0;
              }
              autoscroll();
              caretVertChar = caretChar;
              if (modifiers.Shift) {
                if (caretLine != selection.begin.ln || caretChar != selection.begin.ch) {
                  selection.active = true;
                  caretVisible = false;
                  selection.forward =
                    caretLine > selection.begin.ln ||
                    (caretLine == selection.begin.ln && caretChar > selection.begin.ch);
                } else {
                  selection.active = false;
                  caretVisible = true;
                  caretClock = 0;
                }
              } else {
                deselect = true;
                if (selection.active) {
                  if (!selection.forward) {
                    caretChar = selection.begin.ch;
                    caretLine = selection.begin.ln;
                  }
                }
              }
              break;
            case 'ArrowUp':
              if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1)
                commandHistory[commandIndex].open = false; // this action disrupts typing
              if (caretLine > 0) {
                setEnergy(energy + growthRate);
                typeClock = 0;
                caretLine--;
                caretChar = Math.min(caretVertChar, loadedText[caretLine].length);
              }
              autoscroll();
              if (modifiers.Shift) {
                if (caretLine != selection.begin.ln || caretChar != selection.begin.ch) {
                  selection.active = true;
                  caretVisible = false;
                  selection.forward =
                    caretLine > selection.begin.ln ||
                    (caretLine == selection.begin.ln && caretChar > selection.begin.ch);
                } else {
                  selection.active = false;
                  caretVisible = true;
                  caretClock = 0;
                }
              } else {
                deselect = true;
              }
              break;
            case 'ArrowDown':
              if (commandHistory.length > 0 && commandIndex == commandHistory.length - 1)
                commandHistory[commandIndex].open = false; // this action disrupts typing
              if (caretLine < loadedText.length - 1) {
                setEnergy(energy + growthRate);
                typeClock = 0;
                caretLine++;
                caretChar = Math.min(caretVertChar, loadedText[caretLine].length);
              } else {
                caretChar = loadedText[caretLine].length; // go to end of line with down arrow
              }
              autoscroll();
              if (modifiers.Shift) {
                if (caretLine != selection.begin.ln || caretChar != selection.begin.ch) {
                  selection.active = true;
                  caretVisible = false;
                  selection.forward =
                    caretLine > selection.begin.ln ||
                    (caretLine == selection.begin.ln && caretChar > selection.begin.ch);
                } else {
                  selection.active = false;
                  caretVisible = true;
                  caretClock = 0;
                }
              } else {
                deselect = true;
              }
              break;
          }
        }
      }
      // certain key inputs should reset selection
      if (deselect) {
        selection.begin.ln = caretLine;
        selection.begin.ch = caretChar;
        selection.forward =
          caretLine > selection.begin.ln ||
          (caretLine == selection.begin.ln && caretChar > selection.begin.ch); // not sure why this needs to be here, but it does.
        selection.active = false;
        caretVisible = true;
        caretClock = 0;
      }
    });
    document.addEventListener('keyup', (e) => {
      if (modifiers.hasOwnProperty(e.key)) {
        modifiers[e.key as keyof Imodifiers] = false;
      }
    });
    // clipboard inputs
    document.addEventListener('copy', () => {
      if (selection.active) {
        setEnergy(energy + growthRate);
        typeClock = 0;
        copyRange(loadedText);
      }
    });
    document.addEventListener('cut', () => {
      if (selection.active) {
        saved = false;
        setEnergy(energy + growthRate);
        typeClock = 0;
        copyRange(loadedText);
        deleteRange(loadedText);
        selection.active = false;
        caretVisible = true;
        caretClock = 0;
      }
    });
    document.addEventListener('paste', () => {
      saved = false;
      setEnergy(energy + growthRate);
      typeClock = 0;
      if (selection.active) {
        deleteRange(loadedText);
      }
      paste(loadedText);
    });

    // file i/o startup procedure
    exists('open.it', { dir: BaseDirectory.Temp }).then((e) => {
      if (e) {
        removeFile('open.it', { dir: BaseDirectory.Temp });
        openFile(true); // setting init to true tells it to close the window if the user cancels
      } else {
        exists('new.file', { dir: BaseDirectory.Temp }).then((e) => {
          if (e) {
            removeFile('new.file', { dir: BaseDirectory.Temp }).then(() => {
              showApp(); // if explicitly starting up a blank file from a directly-opened window
            });
          } else if (openedWith != 'false') {
            // load a file directly if one has been specified
            openFile(false, openedWith);
          } else {
            showApp(); // open the app for the first time, no files involved
          }
        });
      }
    });
  };

  //
  //
  //
  //
  //
  //
  // end p5 setup
  //
  //
  //
  //
  //
  //

  // main loop
  p5.draw = () => {
    // scrolling stuff
    // smooth mouse drag scrolling
    if (modifiers.Mouse1) {
      if (p5.mouseY > p5.height - 10) {
        scroll = Math.min(scroll + (p5.mouseY - (p5.height - 10)) * 0.05, loadedText.length - 1);
        mouseMoved(loadedText);
      } else if (p5.mouseY < 42) {
        scroll = Math.max(scroll - (42 - p5.mouseY) * 0.05, 0);
        mouseMoved(loadedText);
      }
    }
    // smooth scrolling
    if (scrollInterp != scroll) {
      scrollInterp += (scroll - scrollInterp) * 0.25;
      if (Math.abs(scroll - scrollInterp) < 0.02) {
        scrollInterp = scroll;
      }
    }

    // unique drawing processes per theme
    switch (theme) {
      case Themes.dark_chroma:
        // graphical pipeline:
        //
        // draw 3 jiggling rectangles (C, M, Y) onto windowGraphics with EXCLUDE blendmode
        // draw windowGraphics onto canvas through glow shader
        // draw phospherescence (random points) onto canvas
        // draw text onto textGraphics
        // draw titlebar onto textGraphics
        // draw shadows onto textGraphics
        // draw textGraphics onto canvas through chroma shader (which masks everything against the un-shaded windowGraphics buffer)
        //

        if (typeClock > typeDelay) {
          setEnergy(energy - decayRate);
        }

        if (saveEffect) {
          saveEffect = false;
          saveFlash = saveFlashStr;
        }

        energyClock += energy; // tick animations
        caretClock++;
        mouseClock++;
        typeClock++;
        typeClockSmooth += (typeClock - typeClockSmooth) * 0.1;
        saveFlash *= 0.9;

        // clear main window and shaded graphics
        p5.clear(0.0, 0.0, 0.0, 0.0);
        textGraphics.clear(0.0, 0.0, 0.0, 0.0);
        windowGraphics.clear(0.0, 0.0, 0.0, 0.0);

        // calculate coordinate offsets for each of the 3 layers
        p1x = p5.cos(energyClock * speed) * split;
        p1y = p5.sin(energyClock * speed) * split;
        p2x = p5.cos(energyClock * speed * 1.5 + 120) * split;
        p2y = p5.sin(energyClock * speed * 1.5 + 120) * split;
        p3x = p5.cos(energyClock * speed * 2 + 240) * split;
        p3y = p5.sin(energyClock * speed * 2 + 240) * split;

        // draw 3 jiggling colored rectangles with exclusion blendmode
        windowGraphics.push();
        windowGraphics.strokeWeight(0.5);
        windowGraphics.blendMode(p5.EXCLUSION); // this blends CMY to K
        windowGraphics.push();
        windowGraphics.fill(255, 255, 0);
        windowGraphics.stroke(255, 255, 0, 127);
        windowGraphics.rotate(p5.cos(energyClock * speed * 1.5) * twist);
        windowGraphics.rect(
          -hw + pageMargin + p1x,
          -hh + pageMargin + p1y,
          p5.width - pageMargin * 2,
          p5.height - pageMargin * 2,
          cornerRadius,
          cornerRadius,
          cornerRadius,
          cornerRadius
        );
        windowGraphics.pop();
        windowGraphics.push();
        windowGraphics.fill(0, 255, 240);
        windowGraphics.stroke(0, 255, 240, 127);
        windowGraphics.rotate(p5.cos(energyClock * speed * 2) * twist);
        windowGraphics.rect(
          -hw + pageMargin + p2x,
          -hh + pageMargin + p2y,
          p5.width - pageMargin * 2,
          p5.height - pageMargin * 2,
          cornerRadius,
          cornerRadius,
          cornerRadius,
          cornerRadius
        );
        windowGraphics.pop();
        windowGraphics.push();
        windowGraphics.fill(255, 0, 240);
        windowGraphics.stroke(255, 0, 240, 127);
        windowGraphics.rotate(p5.cos(energyClock * speed * 2.5) * twist);
        windowGraphics.rect(
          -hw + pageMargin + p3x,
          -hh + pageMargin + p3y,
          p5.width - pageMargin * 2,
          p5.height - pageMargin * 2,
          cornerRadius,
          cornerRadius,
          cornerRadius,
          cornerRadius
        );
        windowGraphics.pop();
        windowGraphics.pop();

        // draw window through glow shader
        p5.push();
        p5.fill(255);
        p5.noStroke();
        p5.shader(perlinGlow);
        perlinGlow.setUniform('u_texture', windowGraphics);
        perlinGlow.setUniform('u_resolution', [p5.width, p5.height]);
        perlinGlow.setUniform('u_clock', energyClock * 0.003);
        perlinGlow.setUniform('u_energy', energy);
        p5.rect(-hw, -hh, p5.width, p5.height);
        p5.pop();

        // draw random noise pixels
        p5.push();
        for (
          let i = 0;
          i < (Math.sqrt(p5.width * p5.height) / 1440) * (energy * energy * energy * 5);
          i++
        ) {
          p5.stroke(p5.random(0, 80 + 40 * energy), 0, p5.random(64, 175 + 40 * energy));
          p5.strokeWeight(p5.random(0.5, 3));
          p5.point(
            p5.random(-hw + textMarginLeft * 0.5, hw - textMarginLeft * 0.5),
            p5.random(-hh + textMarginTop * 0.5, hh - textMarginTop * 0.5)
          );
        }
        p5.pop();

        // draw selection
        if (selection.active) {
          textGraphics.push();
          textGraphics.noStroke();
          textGraphics.fill(70, 70, 130);
          let sbch = selection.begin.ch;
          let sbln = selection.begin.ln;
          let start = Math.max(Math.min(caretLine, sbln), Math.round(scrollInterp - 3));
          let end = Math.min(
            Math.max(caretLine, sbln),
            Math.round(scrollInterp + editableLines + 3)
          );
          for (let i = start; i < end + 1; i++) {
            if (selection.forward) {
              if (caretLine - sbln == 0) {
                // one line selections
                sx = -hw + sbch * charW + textMarginLeft;
                sy = -hh + (caretLine - scrollInterp) * lineH + textMarginTop + fontSize * 0.25; // bottom
                sw = (caretChar - sbch) * charW; // difference between caretChar and sbch
              } else if (i == start) {
                // multi-line selections, first line
                sx = -hw + sbch * charW + textMarginLeft;
                sy = -hh + (start - scrollInterp) * lineH + textMarginTop + fontSize * 0.25; // bottom
                sw = (loadedText[start].length - sbch + 1) * charW; // difference between line length and sbch
              } else if (i < end) {
                // multi-line selections, intermediate lines
                sx = -hw + textMarginLeft;
                sy =
                  -hh +
                  (start - scrollInterp + (i - start)) * lineH +
                  textMarginTop +
                  fontSize * 0.25; // bottom
                sw = (loadedText[start + (i - start)].length + 1) * charW; // line length
              } else {
                // multi-line selections, last line
                sx = -hw + textMarginLeft;
                sy =
                  -hh +
                  (start - scrollInterp + (i - start)) * lineH +
                  textMarginTop +
                  fontSize * 0.25; // bottom
                sw = caretChar * charW; // line length
              }
            } else {
              // reverse selections
              if (caretLine - sbln == 0) {
                // one line selections
                sx = -hw + sbch * charW + textMarginLeft;
                sy = -hh + (caretLine - scrollInterp) * lineH + textMarginTop + fontSize * 0.25; // bottom
                sw = (caretChar - sbch) * charW; // difference between caretChar and sbch
              } else if (i == start) {
                // multi-line selections, first line
                sx = -hw + sbch * charW + textMarginLeft;
                sy = -hh + (sbln - scrollInterp) * lineH + textMarginTop + fontSize * 0.25; // bottom
                // this whole thing is a dumpster fire; the bottom line of a reverse selection can technically be rendered at infinite distance
                sw = -sbch * charW; // difference between line length and sbch
              } else if (i < end) {
                // multi-line selections, intermediate lines
                // even tho this is reverse selection, it's easier to draw the rect from left to right here.
                sx = -hw + textMarginLeft;
                sy =
                  -hh +
                  (end - scrollInterp - (i - start)) * lineH +
                  textMarginTop +
                  fontSize * 0.25; // bottom
                sw = (loadedText[end - (i - start)].length + 1) * charW; // line length
              } else {
                // multi-line selections, last line
                sx = -hw + (loadedText[end - (i - start)].length + 1) * charW + textMarginLeft; // right end
                sy =
                  -hh +
                  (end - scrollInterp - (i - start)) * lineH +
                  textMarginTop +
                  fontSize * 0.25; // bottom
                sw = (caretChar - 1) * charW - loadedText[end - (i - start)].length * charW; // line length
              }
            }
            if (!sw && ((selection.forward && i < end) || (!selection.forward && i != start)))
              // this big logical statement makes the selection appear as expected when selecting empty lines
              sw = charW; // show empty lines and end of line selections
            textGraphics.rect(sx, sy, sw, -lineH);
          }
          textGraphics.pop();
        }

        // draw text line by line
        textGraphics.push();
        textGraphics.fill(255, 240 - 10 * energy, 210 - 15 * energy);
        for (
          let i = Math.round(scrollInterp - 3);
          i < Math.round(scrollInterp + editableLines + 3);
          i++
        ) {
          textGraphics.text(
            loadedText[i],
            -hw + textMarginLeft,
            -hh + textMarginTop + lineH * (i - scrollInterp)
          );
        }
        textGraphics.pop();

        // draw caret
        if (caretVisible) {
          if (p5.sin(caretClock * 6) > 0) {
            textGraphics.push();
            textGraphics.stroke(255, 240, 210 - 15 * energy); // same as text color
            textGraphics.strokeWeight(sf);
            textGraphics.strokeCap(p5.SQUARE);
            let caretX = Math.round(-hw + caretChar * charW + textMarginLeft) + 0.5;
            let caretY = Math.round(
              -hh + (caretLine - scrollInterp) * lineH + textMarginTop + fontSize * 0.25
            ); // bottom
            textGraphics.line(caretX, caretY, caretX, caretY - lineH);
            textGraphics.pop();
          }
        }

        // cover top with title bar
        textGraphics.push();
        textGraphics.noStroke();
        textGraphics.fill(70 + saveFlash, 80 + saveFlash, 90 + saveFlash, 255);
        textGraphics.rect(-hw, -hh, p5.width, 32);
        // draw shadow under the title bar
        let shadowMargin = pageMargin * 0.5;
        let shadowSize = 38 * (energy / 3.0) * (1 - typeClockSmooth / typeDelay);
        let shadowAlpha = 127;
        textGraphics.beginShape(); // top
        textGraphics.fill(0, 0, 0, 160);
        textGraphics.vertex(-hw, -hh + 32);
        textGraphics.vertex(hw, -hh + 32);
        textGraphics.fill(0, 0, 0, 0);
        textGraphics.vertex(hw, -hh + 48);
        textGraphics.vertex(-hw, -hh + 48);
        textGraphics.endShape(p5.CLOSE);
        // draw document title
        textGraphics.fill(230, 230, 255);
        textGraphics.textSize(16);
        textGraphics.text(
          loadedFileName,
          -textGraphics.textWidth(loadedFileName) / 2,
          -hh + 24 + energy
        );
        textGraphics.textSize(fontSize);
        // shadow all around (except left side)
        textGraphics.beginShape();
        textGraphics.fill(0, 0, 0, shadowAlpha);
        textGraphics.vertex(-hw + shadowMargin, -hh + shadowMargin); // top left
        textGraphics.vertex(hw - shadowMargin, -hh + shadowMargin); // top right
        textGraphics.vertex(hw - shadowMargin, hh - shadowMargin); // bottom right
        textGraphics.vertex(-hw + shadowMargin, hh - shadowMargin); // bottom left
        textGraphics.fill(0, 0, 0, 0);
        textGraphics.vertex(-hw + shadowMargin + shadowSize, hh - shadowMargin - shadowSize); // bottom left inner
        textGraphics.vertex(hw - shadowMargin - shadowSize, hh - shadowMargin - shadowSize); // bottom right inner
        textGraphics.vertex(hw - shadowMargin - shadowSize, -hh + shadowMargin + shadowSize); // top right inner
        textGraphics.vertex(-hw + shadowMargin + shadowSize, -hh + shadowMargin + shadowSize); // top left inner
        textGraphics.endShape(p5.CLOSE);
        // left side
        textGraphics.beginShape();
        textGraphics.fill(0, 0, 0, shadowAlpha);
        textGraphics.vertex(-hw + shadowMargin, -hh + shadowMargin); // top left
        textGraphics.vertex(-hw + shadowMargin, hh - shadowMargin); // bottom left
        textGraphics.fill(0, 0, 0, 0);
        textGraphics.vertex(-hw + shadowMargin + shadowSize, hh - shadowMargin - shadowSize); // bottom left inner
        textGraphics.vertex(-hw + shadowMargin + shadowSize, -hh + shadowMargin + shadowSize); // top left inner
        textGraphics.endShape(p5.CLOSE);

        // draw text through chroma shader
        p5.push();
        p5.fill(255);
        p5.noStroke();
        p5.shader(perlinChroma); // set the shader
        perlinChroma.setUniform('u_texture', textGraphics); // pass the graphics buffer into the shader as a sampler2D
        perlinChroma.setUniform('u_mask', windowGraphics); // pass the graphics buffer into the shader as a sampler2D
        perlinChroma.setUniform('u_resolution', [p5.width, p5.height]); // pass the graphics buffer into the shader as a sampler2D
        perlinChroma.setUniform('u_clock', energyClock); // pass the graphics buffer into the shader as a sampler2D
        perlinChroma.setUniform('u_energy', energy); // pass the graphics buffer into the shader as a sampler2D
        p5.rect(-hw, -hh, p5.width, p5.height); // a container (the size of graphics1) to draw graphics1 through the shader
        p5.pop(); // this resets the shader, otherwise need to call resetShader()

        break;
    }
  };
};
