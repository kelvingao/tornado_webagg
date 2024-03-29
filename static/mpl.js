/* Put everything inside the mpl namespace */
var mpl = {};


mpl.get_websocket_type = function() {
    if (typeof(WebSocket) !== 'undefined') {
        return WebSocket;
    } else if (typeof(MozWebSocket) !== 'undefined') {
        return MozWebSocket;
    } else {
        alert('Your browser does not have WebSocket support.' +
              'Please try Chrome, Safari or Firefox ≥ 6. ' +
              'Firefox 4 and 5 are also supported but you ' +
              'have to enable WebSockets in about:config.');
    };
}


mpl.figure = function(figure_id, websocket, ondownload, parent_element) {
    this.id = figure_id;
    console.log('create figure for', figure_id)
    this.ws = websocket;
    console.log(this.ws)

    this.supports_binary = (this.ws.binaryType != undefined);

    if (!this.supports_binary) {
        var warnings = document.getElementById("mpl-warnings");
        if (warnings) {
            warnings.style.display = 'block';
            warnings.textContent = (
                "This browser does not support binary websocket messages. " +
                    "Performance may be slow.");
        }
    }

    this.imageObj = new Image();

    this.context = undefined;
    this.message = undefined;
    this.canvas = undefined;
    this.rubberband_canvas = undefined;
    this.rubberband_context = undefined;
    this.format_dropdown = undefined;

    this.focus_on_mousover = false;

    this.root = $('<div/>');
    this.root.attr('style', 'display: inline-block');
    $(parent_element).append(this.root);

    this._init_header(this);
    this._init_canvas(this);
    this._init_toolbar(this);

    var fig = this;
    console.log(fig)
    console.log(fig.imageObj)

    this.waiting = false;

    onopen_creator = function(fig) {
        return function () {
            fig.send_message("supports_binary", {value: fig.supports_binary});
            fig.send_message("refresh", {});
        }
    };
    this.ws.onopen = onopen_creator(fig);

    onload_creator = function(fig) {
        return function() {
            fig.context.drawImage(fig.imageObj, 0, 0);
            fig.waiting = false;
        };
    };
    this.imageObj.onload = onload_creator(fig);

    this.imageObj.onunload = function() {
        this.ws.close();
    }

    this.ws.onmessage = this._make_on_message_function(this);

    this.ondownload = ondownload;
}


mpl.figure.prototype._init_header = function() {
    var titlebar = $(
        '<div class="ui-dialog-titlebar ui-widget-header ui-corner-all ' +
        'ui-helper-clearfix"/>');
    var titletext = $(
        '<div class="ui-dialog-title" style="width: 100%; ' +
        'text-align: center; padding: 4px;"/>');
    titlebar.append(titletext)
    this.root.append(titlebar);
    this.header = titletext[0];
}


mpl.figure.prototype._init_canvas = function() {
    var fig = this;

    var canvas_div = $('<div/>');
    canvas_div.attr('style', 'position: relative; clear: both;');
    this.root.append(canvas_div);

    var canvas = $('<canvas/>');
    canvas.addClass('mpl-canvas');
    canvas.attr('style', "left: 0; top: 0; z-index: 0;")
    canvas.attr('width', '800');
    canvas.attr('height', '800');

    function canvas_keyboard_event(event) {
        return fig.key_event(event, event['data']);
    }
    canvas_div.keydown('key_press', canvas_keyboard_event);
    canvas_div.keyup('key_release', canvas_keyboard_event);

    canvas_div.append(canvas);

    this.canvas = canvas[0];
    this.context = canvas[0].getContext("2d");

    // create a second canvas which floats on top of the first.
    var rubberband = $('<canvas/>');
    rubberband.attr('style', "position: absolute; left: 0; top: 0; z-index: 1;")
    rubberband.attr('width', '800');
    rubberband.attr('height', '800');
    function mouse_event_fn(event) {
        return fig.mouse_event(event, event['data']);
    }
    rubberband.mousedown('button_press', mouse_event_fn);
    rubberband.mouseup('button_release', mouse_event_fn);
    rubberband.mousemove('motion_notify', mouse_event_fn);
    canvas_div.append(rubberband);

    this.rubberband_canvas = rubberband[0];
    this.rubberband_context = rubberband[0].getContext("2d");
    this.rubberband_context.strokeStyle = "#000000";
}


mpl.figure.prototype._init_toolbar = function() {
    var fig = this;

    var nav_element = $('<div/>')
    nav_element.attr('style', 'width: 100%');
    this.root.append(nav_element);

    // Define a callback function for later on.
    function toolbar_event(event) {
        return fig.toolbar_button_onclick(event['data']);
    }
    function toolbar_mouse_event(event) {
        return fig.toolbar_button_onmouseover(event['data']);
    }

    for(var toolbar_ind in mpl.toolbar_items){
        var name = mpl.toolbar_items[toolbar_ind][0];
        var tooltip = mpl.toolbar_items[toolbar_ind][1];
        var image = mpl.toolbar_items[toolbar_ind][2];
        var method_name = mpl.toolbar_items[toolbar_ind][3];

        if (!name) {
            // put a spacer in here.
            continue;
        }

        var button = $('<button/>');
        button.addClass('ui-button ui-widget ui-state-default ui-corner-all ' +
                        'ui-button-icon-only');
        button.attr('role', 'button');
        button.attr('aria-disabled', 'false');
        button.click(method_name, toolbar_event);
        button.mouseover(tooltip, toolbar_mouse_event);

        var icon_img = $('<span/>');
        icon_img.addClass('ui-button-icon-primary ui-icon');
        icon_img.addClass(image);
        icon_img.addClass('ui-corner-all');

        var tooltip_span = $('<span/>');
        tooltip_span.addClass('ui-button-text');
        tooltip_span.html(tooltip);

        button.append(icon_img);
        button.append(tooltip_span);

        nav_element.append(button);
    }

    var fmt_picker_span = $('<span/>');

    var fmt_picker = $('<select/>');
    fmt_picker.addClass('mpl-toolbar-option ui-widget ui-widget-content');
    fmt_picker_span.append(fmt_picker);
    nav_element.append(fmt_picker_span);
    this.format_dropdown = fmt_picker[0];

    for (var ind in mpl.extensions) {
        var fmt = mpl.extensions[ind];
        var option = $(
            '<option/>', {selected: fmt === mpl.default_extension}).html(fmt);
        fmt_picker.append(option)
    }

    // Add hover states to the ui-buttons
    $( ".ui-button" ).hover(
        function() { $(this).addClass("ui-state-hover");},
        function() { $(this).removeClass("ui-state-hover");}
    );

    var status_bar = $('<span class="mpl-message"/>');
    nav_element.append(status_bar);
    this.message = status_bar[0];
}


mpl.figure.prototype.send_message = function(type, properties) {
    properties['type'] = type;
    properties['figure_id'] = this.id;

    if (this.ws.readyState===1) {
        this.ws.send(JSON.stringify(properties));
    }else{
        console.warn('websocket is not connected.')
    }
    
}


mpl.figure.prototype.send_draw_message = function() {
    if (!this.waiting) {
        this.waiting = true;
        this.ws.send(JSON.stringify({type: "draw", figure_id: this.id}));
    }
}


mpl.figure.prototype._make_on_message_function = function(fig) {
    return function socket_on_message(evt) {
        if (fig.supports_binary) {
            if (evt.data instanceof Blob) {
                /* FIXME: We get "Resource interpreted as Image but
                 * transferred with MIME type text/plain:" errors on
                 * Chrome.  But how to set the MIME type?  It doesn't seem
                 * to be part of the websocket stream */
                evt.data.type = "image/png";

                /* Free the memory for the previous frames */
                if (fig.imageObj.src) {
                    (window.URL || window.webkitURL).revokeObjectURL(
                        fig.imageObj.src);
                }
                fig.imageObj.src = (window.URL || window.webkitURL).createObjectURL(
                    evt.data);
                fig.send_message("ack", {});
                return;
            }
        } else {
            if (evt.data.slice(0, 21) == "data:image/png;base64") {
                fig.imageObj.src = evt.data;
                fig.send_message("ack", {});
                return;
            }
        }

        var msg = JSON.parse(evt.data);

        switch(msg['type']) {
        case 'draw':
            fig.send_draw_message();
            break;

        case 'message':
            fig.message.textContent = msg['message'];
            break;

        case 'cursor':
            var cursor = msg['cursor'];
            switch(cursor)
            {
            case 0:
                cursor = 'pointer';
                break;
            case 1:
                cursor = 'default';
                break;
            case 2:
                cursor = 'crosshair';
                break;
            case 3:
                cursor = 'move';
                break;
            }
            fig.canvas.style.cursor = cursor;
            break;

        case 'resize':
            var size = msg['size'];
            if (size[0] != fig.canvas.width || size[1] != fig.canvas.height) {
                fig.canvas.width = size[0];
                fig.canvas.height = size[1];
                fig.rubberband_canvas.width = size[0];
                fig.rubberband_canvas.height = size[1];
                fig.send_message("refresh", {});
                fig.send_message("supports_binary", {value: fig.supports_binary});
            }
            break;

        case 'rubberband':
            var x0 = msg['x0'];
            var y0 = fig.canvas.height - msg['y0'];
            var x1 = msg['x1'];
            var y1 = fig.canvas.height - msg['y1'];
            x0 = Math.floor(x0) + 0.5;
            y0 = Math.floor(y0) + 0.5;
            x1 = Math.floor(x1) + 0.5;
            y1 = Math.floor(y1) + 0.5;
            var min_x = Math.min(x0, x1);
            var min_y = Math.min(y0, y1);
            var width = Math.abs(x1 - x0);
            var height = Math.abs(y1 - y0);

            fig.rubberband_context.clearRect(
                0, 0, fig.canvas.width, fig.canvas.height);
            fig.rubberband_context.strokeRect(min_x, min_y, width, height);
            break;

        case 'figure_label':
            fig.header.textContent = msg['label'];
            break;
        }
    };
}

// from http://stackoverflow.com/questions/1114465/getting-mouse-location-in-canvas

mpl.findpos = function(e) {
    //this section is from http://www.quirksmode.org/js/events_properties.html
    var targ;
    if (!e)
        e = window.event;
    if (e.target)
        targ = e.target;
    else if (e.srcElement)
        targ = e.srcElement;
    if (targ.nodeType == 3) // defeat Safari bug
        targ = targ.parentNode;

    // jQuery normalizes the pageX and pageY
    // pageX,Y are the mouse positions relative to the document
    // offset() returns the position of the element relative to the document
    var x = e.pageX - $(targ).offset().left;
    var y = e.pageY - $(targ).offset().top;

    return {"x": x, "y": y};
};


mpl.figure.prototype.mouse_event = function(event, name) {
    var canvas_pos = mpl.findpos(event)

    if (this.focus_on_mouseover && name === 'motion_notify')
    {
        this.canvas.focus();
    }

    var x = canvas_pos.x;
    var y = canvas_pos.y;

    this.send_message(name, {x: x, y: y, button: event.button});

    /* This prevents the web browser from automatically changing to
     * the text insertion cursor when the button is pressed.  We want
     * to control all of the cursor setting manually through the
     * 'cursor' event from matplotlib */
    event.preventDefault();
    return false;
}


mpl.figure.prototype.key_event = function(event, name) {
    /* Don't fire events just when a modifier is changed.  Modifiers are
       sent along with other keys. */
    if (event.keyCode >= 16 && event.keyCode <= 20) {
        return;
    }

    value = '';
    if (event.ctrlKey) {
        value += "ctrl+";
    }
    if (event.altKey) {
        value += "alt+";
    }
    value += String.fromCharCode(event.keyCode).toLowerCase();

    this.send_message(name, {key: value});
}


mpl.figure.prototype.toolbar_button_onclick = function(name) {
    if (name == 'download') {
        var format_dropdown = this.format_dropdown;
        var format = format_dropdown.options[format_dropdown.selectedIndex].value;
        this.ondownload(this, format);
    } else {
        this.send_message("toolbar_button", {name: name});
    }
};


mpl.figure.prototype.toolbar_button_onmouseover = function(tooltip) {
    this.message.textContent = tooltip;
};

mpl.toolbar_items = [["Home", "Reset original view", "ui-icon ui-icon-home", "home"],
                     ["Back", "Back to  previous view", "ui-icon ui-icon-circle-arrow-w", "back"],
		     ["Forward", "Forward to next view", "ui-icon ui-icon-circle-arrow-e", "forward"],
		     ["", "", "", ""],
		     ["Pan", "Pan axes with left mouse, zoom with right", "ui-icon ui-icon-arrow-4", "pan"],
		     ["Zoom", "Zoom to rectangle", "ui-icon ui-icon-search", "zoom"],
		     ["", "", "", ""],
		     ["Download", "Download plot", "ui-icon ui-icon-disk", "download"]];

mpl.extensions = ["eps", "jpeg", "pgf", "pdf", "png", "ps", "raw", "svg", "tif"];

mpl.default_extension = "png";
